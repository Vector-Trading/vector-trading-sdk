from vector_trading import RestClient, SdkError


def list_bundle_names(base_url: str, account_api_key: str) -> list[str]:
    """Credentials belong to a server-side integration; calling this function sends HTTP."""
    with RestClient(base_url=base_url, account_api_key=account_api_key) as client:
        try:
            return [
                bundle.name
                for page in client.list_bundles_pages(limit=50)
                for bundle in page.bundles
            ]
        except SdkError as error:
            if error.status == 429:
                raise RuntimeError(
                    "Rate limited; decide whether to retry in the calling application"
                ) from None
            raise
