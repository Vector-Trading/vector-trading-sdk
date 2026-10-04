// Command check runs native Go verification and a clean local-proxy consumer.
package main

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type pins struct {
	Go            string `json:"go"`
	GoAlsoTested  string `json:"goAlsoTested"`
	Staticcheck   string `json:"staticcheck"`
	StaticcheckGo string `json:"staticcheckGo"`
}

var root string
var config pins

func show(output string) {
	if output != "" {
		fmt.Println(output)
	}
}
func fail(err error) {
	if err != nil {
		panic(err)
	}
}
func environment(extra map[string]string) []string {
	values := map[string]string{}
	for _, entry := range os.Environ() {
		key, value, _ := strings.Cut(entry, "=")
		values[key] = value
	}
	values["GOTOOLCHAIN"] = "local"
	values["GOPROXY"] = "off"
	values["GOSUMDB"] = "off"
	for k, v := range extra {
		values[k] = v
	}
	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	env := make([]string, 0, len(keys))
	for _, k := range keys {
		env = append(env, k+"="+values[k])
	}
	return env
}
func run(binary string, args []string, cwd string, extra map[string]string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	command := exec.CommandContext(ctx, binary, args...)
	command.WaitDelay = 5 * time.Second
	command.Dir = cwd
	command.Env = environment(extra)
	var output bytes.Buffer
	command.Stdout = &output
	command.Stderr = &output
	if err := command.Run(); err != nil {
		fail(fmt.Errorf("%s %v failed: %s", filepath.Base(binary), args, output.String()))
	}
	return strings.TrimSpace(output.String())
}
func tool(name, fallback string) string {
	if selected := os.Getenv(name); selected != "" {
		return selected
	}
	return fallback
}
func compiler(name, version string) string {
	binary := tool(name, "go")
	actual := run(binary, []string{"env", "GOVERSION"}, root, nil)
	if actual != "go"+version {
		fail(fmt.Errorf("select Go %s through %s (found %s); prepare it explicitly before checks", version, name, actual))
	}
	return binary
}
func format(goBinary string) {
	goroot := run(goBinary, []string{"env", "GOROOT"}, root, nil)
	gofmt := filepath.Join(goroot, "bin", "gofmt")
	var sources []string
	fail(filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() && (d.Name() == "dist" || d.Name() == ".cache") {
			return filepath.SkipDir
		}
		if !d.IsDir() && strings.HasSuffix(path, ".go") {
			sources = append(sources, path)
		}
		return nil
	}))
	if out := run(gofmt, append([]string{"-l"}, sources...), root, nil); out != "" {
		fail(fmt.Errorf("run gofmt before checking: %s", out))
	}
}
func nativeChecks(goBinary string) {
	before, err := os.ReadFile(filepath.Join(root, "go.mod"))
	fail(err)
	show(run(goBinary, []string{"mod", "tidy", "-diff"}, root, nil))
	after, err := os.ReadFile(filepath.Join(root, "go.mod"))
	fail(err)
	if !bytes.Equal(before, after) {
		fail(fmt.Errorf("go mod tidy changed the module"))
	}
	if _, err := os.Stat(filepath.Join(root, "go.sum")); !os.IsNotExist(err) {
		fail(fmt.Errorf("a zero-dependency module must not have go.sum"))
	}
	module := run(goBinary, []string{"list", "-mod=readonly", "-m", "all"}, root, nil)
	if module != "github.com/Vector-Trading/vector-trading-sdk/go" {
		fail(fmt.Errorf("unexpected runtime graph: %s", module))
	}
	for _, args := range [][]string{{"vet", "./..."}, {"test", "-mod=readonly", "-race", "./..."}, {"build", "-mod=readonly", "./..."}} {
		out := run(goBinary, args, root, nil)
		if out != "" {
			fmt.Println(out)
		}
	}
}

const modulePath = "github.com/Vector-Trading/vector-trading-sdk/go"
const version = "v0.1.0"

func allowed(name string) bool {
	if name == "go.mod" || name == "README.md" || name == "LICENSE" {
		return true
	}
	if strings.HasPrefix(name, "internal/generated/") {
		return strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "/contract.json")
	}
	if strings.HasPrefix(name, "examples/") {
		return strings.HasSuffix(name, ".go")
	}
	return !strings.Contains(name, "/") && strings.HasSuffix(name, ".go") && !strings.HasSuffix(name, "_test.go")
}
func archive() []byte {
	var names []string
	fail(filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("module symlinks are not supported")
		}
		if d.IsDir() && (d.Name() == "dist" || d.Name() == ".cache") {
			return filepath.SkipDir
		}
		name, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		name = filepath.ToSlash(name)
		if !d.IsDir() && allowed(name) {
			names = append(names, name)
		}
		return nil
	}))
	sort.Strings(names)
	var data bytes.Buffer
	writer := zip.NewWriter(&data)
	for _, name := range names {
		header := &zip.FileHeader{Name: modulePath + "@" + version + "/" + name, Method: zip.Deflate}
		header.Modified = time.Date(1980, 1, 1, 0, 0, 0, 0, time.UTC)
		header.SetMode(0644)
		file, err := writer.CreateHeader(header)
		fail(err)
		content, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(name)))
		fail(err)
		_, err = file.Write(content)
		fail(err)
	}
	fail(writer.Close())
	result := data.Bytes()
	fmt.Printf("Module archive: %d allowed files, SHA-256 %s\n", len(names), digest(result))
	return result
}
func digest(data []byte) string { hash := sha256.Sum256(data); return hex.EncodeToString(hash[:]) }
func buildArchive() []byte {
	data := archive()
	second := archive()
	if !bytes.Equal(data, second) {
		fail(fmt.Errorf("archive is not reproducible"))
	}
	fail(os.MkdirAll(filepath.Join(root, "dist"), 0755))
	fail(os.WriteFile(filepath.Join(root, "dist", "vector-trading-sdk-"+version+".zip"), data, 0644))
	return data
}
func escapeModule(path string) string {
	var result strings.Builder
	for _, r := range path {
		if r >= 'A' && r <= 'Z' {
			result.WriteByte('!')
			result.WriteRune(r + ('a' - 'A'))
		} else {
			result.WriteRune(r)
		}
	}
	return result.String()
}
func consumer(goBinary string, data []byte) {
	temp, err := os.MkdirTemp("", "vector-sdk-go-consumer-")
	fail(err)
	defer func() { _ = os.RemoveAll(temp) }()
	proxy := filepath.Join(temp, "proxy")
	versions := filepath.Join(proxy, filepath.FromSlash(escapeModule(modulePath)), "@v")
	fail(os.MkdirAll(versions, 0755))
	mod, err := os.ReadFile(filepath.Join(root, "go.mod"))
	fail(err)
	for name, contents := range map[string][]byte{version + ".zip": data, version + ".mod": mod, version + ".info": []byte(`{"Version":"v0.1.0","Time":"2000-01-01T00:00:00Z"}`), "list": []byte(version + "\n")} {
		fail(os.WriteFile(filepath.Join(versions, name), contents, 0644))
	}
	project := filepath.Join(temp, "consumer")
	fail(os.MkdirAll(project, 0755))
	fail(os.WriteFile(filepath.Join(project, "go.mod"), []byte("module vector_sdk_consumer\n\ngo 1.26.0\n\nrequire "+modulePath+" "+version+"\n"), 0644))
	source, err := os.ReadFile(filepath.Join(root, "tools", "consumer", "main.go"))
	fail(err)
	fail(os.WriteFile(filepath.Join(project, "main.go"), source, 0644))
	env := map[string]string{"GOPROXY": (&url.URL{Scheme: "file", Path: proxy}).String(), "GOMODCACHE": filepath.Join(temp, "modules"), "GOWORK": "off"}
	var download struct {
		Dir   string
		Sum   string
		Error string
	}
	fail(json.Unmarshal([]byte(run(goBinary, []string{"mod", "download", "-json", modulePath + "@" + version}, project, env)), &download))
	if download.Error != "" || !strings.HasPrefix(download.Dir, env["GOMODCACHE"]+string(os.PathSeparator)) {
		fail(fmt.Errorf("module archive was not installed in the clean cache"))
	}
	fmt.Println("Local proxy module downloaded:", download.Sum)
	show(run(goBinary, []string{"mod", "tidy"}, project, env))
	graph := run(goBinary, []string{"list", "-mod=readonly", "-m", "all"}, project, env)
	if graph != "vector_sdk_consumer\n"+modulePath+" "+version {
		fail(fmt.Errorf("consumer dependency graph differs: %s", graph))
	}
	location := run(goBinary, []string{"list", "-f", "{{.Dir}}", modulePath}, project, env)
	if !strings.HasPrefix(location, env["GOMODCACHE"]+string(os.PathSeparator)) {
		fail(fmt.Errorf("consumer used working tree instead of module cache"))
	}
	env["GOPROXY"] = "off"
	show(run(goBinary, []string{"run", "-mod=readonly", "."}, project, env))
	for _, args := range [][]string{{"vet", "./..."}, {"build", "-mod=readonly", "./..."}} {
		show(run(goBinary, args, project, env))
	}
	fmt.Println("Installed graph contains only the consumer and SDK; offline compilation passed")
}
func main() {
	defer func() {
		if err := recover(); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	}()
	var err error
	root, err = os.Getwd()
	fail(err)
	data, err := os.ReadFile(filepath.Join(root, "toolchains.json"))
	fail(err)
	fail(json.Unmarshal(data, &config))
	if len(os.Args) != 2 {
		fail(fmt.Errorf("usage: go run ./tools/check test|build|package"))
	}
	primary := compiler("SDK_GO126", config.Go)
	format(primary)
	switch os.Args[1] {
	case "test":
		for _, binary := range []string{primary, compiler("SDK_GO127", config.GoAlsoTested)} {
			show(run(binary, []string{"version"}, root, nil))
			nativeChecks(binary)
		}
		staticcheck := tool("SDK_STATICCHECK", filepath.Join(root, "../.cache/go-tools/staticcheck"))
		versionOutput := run(staticcheck, []string{"-version"}, root, nil)
		if !strings.Contains(versionOutput, "("+strings.TrimPrefix(config.Staticcheck, "v")+")") {
			fail(fmt.Errorf("staticcheck pin differs: %s", versionOutput))
		}
		toolGo := compiler("SDK_GO127", config.StaticcheckGo)
		toolRoot := run(toolGo, []string{"env", "GOROOT"}, root, nil)
		show(run(staticcheck, []string{"./..."}, root, map[string]string{"GOROOT": toolRoot, "PATH": filepath.Join(toolRoot, "bin") + string(os.PathListSeparator) + os.Getenv("PATH")}))
	case "build":
		show(run(primary, []string{"build", "-mod=readonly", "./..."}, root, nil))
		buildArchive()
	case "package":
		data := buildArchive()
		consumer(primary, data)
		consumer(compiler("SDK_GO127", config.GoAlsoTested), data)
	default:
		fail(fmt.Errorf("unknown native command"))
	}
}
