import os
import uuid
from urllib.parse import quote

from django.conf import settings
from django.core.files.storage import Storage
from django.utils.deconstruct import deconstructible


@deconstructible
class AzureBlobStorage(Storage):
    """
    Minimal Azure Blob storage backend for product images.
    Uses existing Azure account/container config and stores files under `mt-images/`.
    """

    folder = "mt-images"

    def __init__(self):
        self.account_name = getattr(settings, "AZURE_STORAGE_ACCOUNT_NAME", "")
        self.container = getattr(settings, "AZURE_STORAGE_CONTAINER", "barcode-labels")
        self.account_key = getattr(settings, "AZURE_STORAGE_ACCOUNT_KEY", "")
        self.use_sas_tokens = getattr(settings, "AZURE_USE_SAS_TOKENS", False)

    def _blob_name(self, name: str) -> str:
        clean_name = name.lstrip("/")
        if clean_name.startswith(f"{self.folder}/"):
            return clean_name
        return f"{self.folder}/{clean_name}"

    def _open(self, name, mode="rb"):
        raise NotImplementedError("Reading blobs through Django storage is not implemented")

    def _save(self, name, content):
        if not self.account_name or not self.account_key:
            raise ValueError("Azure Storage is not configured for product image uploads")

        try:
            from azure.storage.blob import BlobServiceClient, ContentSettings
        except ImportError as exc:
            raise ValueError("azure-storage-blob package is required for product image uploads") from exc

        base_name, ext = os.path.splitext(name or "")
        ext = ext.lower() if ext else ".jpg"
        random_name = f"{uuid.uuid4().hex}{ext}"
        blob_name = self._blob_name(random_name)

        connection_string = (
            f"DefaultEndpointsProtocol=https;"
            f"AccountName={self.account_name};"
            f"AccountKey={self.account_key};"
            "EndpointSuffix=core.windows.net"
        )
        blob_service_client = BlobServiceClient.from_connection_string(connection_string)
        blob_client = blob_service_client.get_blob_client(container=self.container, blob=blob_name)

        content_type = getattr(content, "content_type", None) or "application/octet-stream"
        blob_client.upload_blob(
            content,
            overwrite=True,
            content_settings=ContentSettings(content_type=content_type),
        )
        return blob_name

    def delete(self, name):
        if not (self.account_name and self.account_key and name):
            return
        if str(name).startswith(("http://", "https://", "data:image")):
            return
        try:
            from azure.core.exceptions import ResourceNotFoundError
            from azure.storage.blob import BlobServiceClient

            connection_string = (
                f"DefaultEndpointsProtocol=https;"
                f"AccountName={self.account_name};"
                f"AccountKey={self.account_key};"
                "EndpointSuffix=core.windows.net"
            )
            blob_service_client = BlobServiceClient.from_connection_string(connection_string)
            blob_client = blob_service_client.get_blob_client(container=self.container, blob=name)
            blob_client.delete_blob()
        except Exception:
            return

    def exists(self, name):
        return False

    def url(self, name):
        if not name:
            return ""
        if str(name).startswith(("http://", "https://", "data:image")):
            return str(name)
        encoded = quote(name, safe="/")
        base_url = f"https://{self.account_name}.blob.core.windows.net/{self.container}/{encoded}"
        if not self.use_sas_tokens:
            return base_url
        try:
            from backend.catalog.azure_label_service import generate_sas_token

            token = generate_sas_token(name)
            if token:
                return f"{base_url}?{token}"
        except Exception:
            pass
        return base_url


@deconstructible
class ProductImageStorage(AzureBlobStorage):
    folder = "mt-images"
