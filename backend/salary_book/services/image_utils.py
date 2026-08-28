import io
import os

from django.core.files.base import ContentFile
from django.core.files.uploadedfile import UploadedFile
from rest_framework.exceptions import ValidationError

ALLOWED_CONTENT_TYPES = {'image/jpeg', 'image/jpg', 'image/png', 'image/webp'}
ALLOWED_EXT = {'.jpg', '.jpeg', '.png', '.webp'}
MAX_BYTES = 2 * 1024 * 1024
MAX_EDGE = 1600


def validate_and_compress_image(uploaded, field_name='photo'):
    if not uploaded:
        return None
    size = getattr(uploaded, 'size', None)
    if size is not None and size > MAX_BYTES * 4:
        raise ValidationError({field_name: 'Image is too large. Please capture a smaller photo.'})

    content_type = (getattr(uploaded, 'content_type', None) or '').lower()
    name = getattr(uploaded, 'name', '') or 'photo.jpg'
    ext = os.path.splitext(name)[1].lower()
    if content_type and content_type not in ALLOWED_CONTENT_TYPES and ext not in ALLOWED_EXT:
        raise ValidationError({field_name: 'Photo must be a JPEG, PNG, or WebP image.'})
    if ext and ext not in ALLOWED_EXT and not content_type:
        raise ValidationError({field_name: 'Photo must be a JPEG, PNG, or WebP image.'})

    try:
        from PIL import Image, UnidentifiedImageError
    except ImportError as exc:
        raise ValidationError({field_name: 'Image processing is unavailable.'}) from exc

    try:
        uploaded.seek(0)
        image = Image.open(uploaded)
        image.load()
    except (UnidentifiedImageError, OSError):
        raise ValidationError({field_name: 'The uploaded file is not a valid image.'})

    if image.width < 32 or image.height < 32:
        raise ValidationError({field_name: 'Photo is too small. Please retake the photograph.'})

    image = image.convert('RGB')
    image.thumbnail((MAX_EDGE, MAX_EDGE))

    buffer = io.BytesIO()
    image.save(buffer, format='JPEG', quality=72, optimize=True)
    data = buffer.getvalue()
    if len(data) > MAX_BYTES:
        buffer = io.BytesIO()
        image.save(buffer, format='JPEG', quality=55, optimize=True)
        data = buffer.getvalue()
    if len(data) > MAX_BYTES:
        raise ValidationError({field_name: 'Image is too large. Please capture a smaller photo.'})

    return ContentFile(data, name=f'{os.path.splitext(os.path.basename(name))[0]}.jpg')


def maybe_compress(files, field_name):
    if not files:
        return None
    raw = files.get(field_name)
    if not raw:
        return None
    if not isinstance(raw, UploadedFile) and not hasattr(raw, 'read'):
        return raw
    return validate_and_compress_image(raw, field_name)
