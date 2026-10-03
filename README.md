# Vector Trading SDK

Репозиторий SDK Vector Trading для JavaScript/TypeScript, Python, Go и Rust, а также
исходников формирования сигналов Pine Script. Лицензия — MIT.

Сейчас подготовлена общая среда разработки. Языковые пакеты, снимок публичного контракта
и публикации в реестрах ещё не реализованы. Состав работ и их подтверждённый статус
хранятся в [плане](docs/plans/public-sdk.plan.md).

Для работы нужны Node.js из `.nvmrc` и pnpm из `packageManager` в `package.json`:

```sh
source ~/.nvm/nvm.sh
nvm use
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
```

Установка инструментов и назначение команд описаны в
[руководстве разработчика](docs/development.md), текущие границы — в
[архитектуре](docs/architecture.md).

SDK будет выполнять HTTP-запросы и формировать JSON сигналов. Торговые правила,
авторизация и исполнение принадлежат серверу. Ключ аккаунта для REST предназначен
для серверных интеграций; ключ стратегии для вебхука — отдельные учётные данные.
