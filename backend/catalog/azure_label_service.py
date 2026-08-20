"""
Azure Function service for generating barcode labels.
This service calls the Azure Function to generate labels and store them in Blob Storage.
"""
import os
import requests
import logging
from typing import Optional, Dict, Any
from django.conf import settings
from urllib.parse import quote

logger = logging.getLogger(__name__)

# Azure Function URL (configure in settings or environment)
AZURE_FUNCTION_URL = getattr(
    settings,
    'AZURE_FUNCTION_URL',
    os.getenv('AZURE_FUNCTION_URL', '')
)

# Azure Function Key (for authentication)
AZURE_FUNCTION_KEY = getattr(
    settings,
    'AZURE_FUNCTION_KEY',
    os.getenv('AZURE_FUNCTION_KEY', '')
)

# Azure Storage Configuration (for constructing blob URLs)
AZURE_STORAGE_ACCOUNT_NAME = getattr(
    settings,
    'AZURE_STORAGE_ACCOUNT_NAME',
    os.getenv('AZURE_STORAGE_ACCOUNT_NAME', '')
)

AZURE_STORAGE_CONTAINER = getattr(
    settings,
    'AZURE_STORAGE_CONTAINER',
    os.getenv('AZURE_STORAGE_CONTAINER', 'barcode-labels')
)

AZURE_BLOB_FOLDER = getattr(
    settings,
    'AZURE_BLOB_FOLDER',
    os.getenv('AZURE_BLOB_FOLDER', '').strip()
)

# Ensure folder path ends with / if provided and not empty
if AZURE_BLOB_FOLDER and not AZURE_BLOB_FOLDER.endswith('/'):
    AZURE_BLOB_FOLDER += '/'

# Azure Storage Account Key (for SAS tokens)
AZURE_STORAGE_ACCOUNT_KEY = getattr(
    settings,
    'AZURE_STORAGE_ACCOUNT_KEY',
    os.getenv('AZURE_STORAGE_ACCOUNT_KEY', '')
)

# Use SAS tokens for blob URLs (if container is private)
AZURE_USE_SAS_TOKENS = getattr(
    settings,
    'AZURE_USE_SAS_TOKENS',
    os.getenv('AZURE_USE_SAS_TOKENS', 'false').lower() == 'true'
)


def generate_sas_token(blob_name: str, expiry_hours: int = 8760) -> Optional[str]:
    """
    Generate a SAS (Shared Access Signature) token for a blob.
    This allows temporary access to private blobs.
    
    Args:
        blob_name: Name of the blob (with folder path)
        expiry_hours: Hours until token expires (default: 1 year)
    
    Returns:
        SAS token string or None if not configured
    """
    if not AZURE_STORAGE_ACCOUNT_NAME or not AZURE_STORAGE_ACCOUNT_KEY:
        return None
    
    try:
        from azure.storage.blob import BlobServiceClient, generate_container_sas, ContainerSasPermissions
        from datetime import datetime, timedelta, timezone
        
        # Calculate expiry time
        expiry_time = datetime.now(timezone.utc) + timedelta(hours=expiry_hours)
        
        # Generate SAS token for the container
        sas_token = generate_container_sas(
            account_name=AZURE_STORAGE_ACCOUNT_NAME,
            container_name=AZURE_STORAGE_CONTAINER,
            account_key=AZURE_STORAGE_ACCOUNT_KEY,
            permission=ContainerSasPermissions(read=True),
            expiry=expiry_time
        )
        
        return sas_token
    except ImportError:
        logger.warning("azure-storage-blob not installed. Install it to use SAS tokens: pip install azure-storage-blob")
        return None
    except Exception as e:
        logger.error(f"Failed to generate SAS token: {str(e)}")
        return None


def construct_blob_url(barcode_id: int, **kwargs) -> Optional[str]:
    """
    Construct the blob URL for a barcode label before Azure uploads it.
    This matches the pattern used in Azure Function: {folder}barcode-{barcode_id}.png
    
    If container is private and SAS tokens are enabled, generates a signed URL.
    Otherwise, returns a direct URL (requires container to be public).
    
    Args:
        barcode_id: Barcode ID
    
    Returns:
        Blob URL string (with SAS token if needed) or None if storage account not configured
    """
    if not AZURE_STORAGE_ACCOUNT_NAME:
        return None
    
    # Construct blob name (matches Azure Function pattern)
    # Default prefix is 'barcode-', but can be overridden (e.g., 'barcode-repair-')
    prefix = kwargs.get('prefix', 'barcode')
    filename = f"{prefix}-{barcode_id}.png"
    blob_name = f"{AZURE_BLOB_FOLDER}{filename}"
    
    # URL encode the blob name, but keep forward slashes (they're path separators in Azure)
    # Only encode special characters, not the folder structure
    encoded_blob_name = quote(blob_name, safe='/')
    
    # Construct base blob URL
    base_url = f"https://{AZURE_STORAGE_ACCOUNT_NAME}.blob.core.windows.net/{AZURE_STORAGE_CONTAINER}/{encoded_blob_name}"
    
    # If using SAS tokens (container is private), add SAS token
    if AZURE_USE_SAS_TOKENS:
        sas_token = generate_sas_token(blob_name)
        if sas_token:
            # Add SAS token to URL
            separator = '&' if '?' in base_url else '?'
            blob_url = f"{base_url}{separator}{sas_token}"
            return blob_url
        else:
            logger.warning(f"Failed to generate SAS token for blob {blob_name}, using direct URL (may fail if container is private)")
    
    # Return direct URL (will work if container is public)
    return base_url


def delete_blob_from_azure(barcode_id: int) -> bool:
    """
    Delete a blob from Azure Storage for a given barcode ID.
    
    Args:
        barcode_id: Barcode ID to delete the blob for
    
    Returns:
        True if deletion was successful or not needed, False if deletion failed
    """
    if not AZURE_STORAGE_ACCOUNT_NAME:
        # Azure Storage not configured, nothing to delete
        return True
    
    if not AZURE_STORAGE_ACCOUNT_KEY:
        # Silently return - blob cleanup is best effort
        return False
    
    try:
        from azure.storage.blob import BlobServiceClient
        from azure.core.exceptions import ResourceNotFoundError
        
        # Construct blob name (matches Azure Function pattern)
        filename = f"barcode-{barcode_id}.png"
        blob_name = f"{AZURE_BLOB_FOLDER}{filename}"
        
        # Create blob service client
        connection_string = f"DefaultEndpointsProtocol=https;AccountName={AZURE_STORAGE_ACCOUNT_NAME};AccountKey={AZURE_STORAGE_ACCOUNT_KEY};EndpointSuffix=core.windows.net"
        blob_service_client = BlobServiceClient.from_connection_string(connection_string)
        
        # Get blob client
        blob_client = blob_service_client.get_blob_client(
            container=AZURE_STORAGE_CONTAINER,
            blob=blob_name
        )
        
        # Delete the blob
        blob_client.delete_blob()
        return True
        
    except ImportError:
        # Silently return - azure-storage-blob not installed
        return False
    except ResourceNotFoundError:
        # Blob doesn't exist, which is fine - may have been deleted already
        return True
    except Exception:
        # Silently fail - blob cleanup is best effort, don't log
        return False


def delete_blobs_for_barcodes(barcode_ids: list) -> int:
    """
    Delete multiple blobs from Azure Storage for a list of barcode IDs.
    Silent operation - all errors are suppressed.
    
    Args:
        barcode_ids: List of barcode IDs to delete blobs for
    
    Returns:
        Number of blobs successfully deleted (or that didn't exist)
    """
    if not barcode_ids:
        return 0
    
    deleted_count = 0
    for barcode_id in barcode_ids:
        if delete_blob_from_azure(barcode_id):
            deleted_count += 1
    
    return deleted_count


def delete_blobs_for_barcodes_async(barcode_ids: list):
    """
    Fire-and-forget blob deletion. Returns immediately without blocking.
    Deletion happens synchronously but errors are suppressed.
    
    Args:
        barcode_ids: List of barcode IDs to delete blobs for
    """
    if not barcode_ids:
        return
    
    # Fire-and-forget: Call deletion but suppress all errors
    # This allows the main operation to complete without waiting
    try:
        delete_blobs_for_barcodes(barcode_ids)
    except Exception:
        # Silently ignore - blob cleanup is best effort
        pass


def format_date_dd_mm_yyyy(date_value: Optional[str]) -> Optional[str]:
    """
    Format a date string to dd-mm-yyyy format.
    Handles various input formats and converts them to dd-mm-yyyy.
    
    Args:
        date_value: Date string in various formats (YYYY-MM-DD, YYYY/MM/DD, etc.) or None
    
    Returns:
        Date string in dd-mm-yyyy format or None
    """
    if not date_value:
        return None
    
    try:
        from datetime import datetime
        
        # Try to parse common date formats
        date_formats = [
            '%Y-%m-%d',      # 2024-01-15
            '%Y/%m/%d',      # 2024/01/15
            '%d-%m-%Y',      # 15-01-2024 (already correct format)
            '%d/%m/%Y',      # 15/01/2024
            '%Y-%m-%d %H:%M:%S',  # 2024-01-15 10:30:00
            '%Y-%m-%dT%H:%M:%S',  # ISO format
        ]
        
        parsed_date = None
        for date_format in date_formats:
            try:
                parsed_date = datetime.strptime(str(date_value).strip(), date_format)
                break
            except ValueError:
                continue
        
        if parsed_date:
            # Format to dd-mm-yyyy
            return parsed_date.strftime('%d-%m-%Y')
        else:
            # If parsing fails, return as-is (might already be in correct format)
            logger.warning(f"Could not parse date format: {date_value}, using as-is")
            return str(date_value)
    except Exception as e:
        logger.warning(f"Error formatting date {date_value}: {str(e)}, using as-is")
        return str(date_value)


def queue_bulk_label_generation_via_azure(barcodes_data: list) -> Dict[int, Optional[str]]:
    """
    Queue multiple label generations via Azure Function in a single request (bulk).
    This function sends all barcodes in one HTTP request and returns immediately.
    The Azure Function will process all barcodes in a loop.
    
    Args:
        barcodes_data: List of dictionaries, each containing:
            - product_name: str
            - barcode_value: str
            - short_code: Optional[str] (short barcode code without date)
            - barcode_id: int
            - vendor_name: Optional[str] (vendor code preferred; Azure Function field name unchanged)
            - purchase_date: Optional[str] (will be formatted to dd-mm-yyyy)
            - serial_number: Optional[str]
    
    Returns:
        Dictionary mapping barcode_id to blob_url (or None if failed)
    """
    if not AZURE_FUNCTION_URL:
        logger.warning("AZURE_FUNCTION_URL not configured, skipping bulk Azure label generation")
        return {item['barcode_id']: None for item in barcodes_data}
    
    if not barcodes_data:
        return {}
    
    # Construct blob URLs for all barcodes and format dates to dd-mm-yyyy
    blob_urls = {}
    formatted_barcodes_data = []
    
    for item in barcodes_data:
        barcode_id = item['barcode_id']
        barcode_type = item.get('barcode_type', 'product')
        prefix = 'barcode-repair' if barcode_type == 'repair' else 'barcode'
        
        blob_url = construct_blob_url(barcode_id, prefix=prefix)
        blob_urls[barcode_id] = blob_url
        
        # Normalize payload: always prefer short_code over full barcode when available.
        # This keeps printed/scannable code values consistent across Azure label generation.
        formatted_item = item.copy()
        short_code = str(formatted_item.get('short_code') or '').strip()
        if short_code:
            formatted_item['barcode_value'] = short_code
        elif formatted_item.get('barcode_value') is not None:
            formatted_item['barcode_value'] = str(formatted_item['barcode_value']).strip()

        # Format purchase_date to dd-mm-yyyy if present
        if 'purchase_date' in formatted_item:
            formatted_item['purchase_date'] = format_date_dd_mm_yyyy(formatted_item['purchase_date'])
        
        formatted_barcodes_data.append(formatted_item)
    
    # Prepare headers
    headers = {
        'Content-Type': 'application/json'
    }
    
    # Add function key if provided
    if AZURE_FUNCTION_KEY:
        headers['x-functions-key'] = AZURE_FUNCTION_KEY
    
    # Chunk large batches so Azure Function HTTP handler is less likely to time out.
    BULK_CHUNK_SIZE = 25
    for offset in range(0, len(formatted_barcodes_data), BULK_CHUNK_SIZE):
        chunk = formatted_barcodes_data[offset : offset + BULK_CHUNK_SIZE]
        chunk_payload = {'barcodes': chunk}
        try:
            requests.post(
                AZURE_FUNCTION_URL,
                json=chunk_payload,
                headers=headers,
                timeout=10,
            )
            logger.info(
                'Queued bulk label generation chunk (%s barcodes, offset %s) via Azure Function',
                len(chunk),
                offset,
            )
        except requests.exceptions.Timeout:
            logger.debug(
                'Bulk label chunk queued (%s barcodes, offset %s); timeout acceptable for async processing',
                len(chunk),
                offset,
            )
        except requests.exceptions.RequestException as e:
            logger.warning(
                'Failed to queue bulk label chunk (%s barcodes, offset %s): %s',
                len(chunk),
                offset,
                e,
            )
        except Exception as e:
            logger.warning(f"Error queuing bulk label generation chunk: {str(e)}")

    return blob_urls
