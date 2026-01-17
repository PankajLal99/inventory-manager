"""
Memory-optimized local label generator - replaces external Labelary API dependency
Uses PIL/Pillow and python-barcode for efficient label generation
"""
import io
import base64
from PIL import Image, ImageDraw, ImageFont
from typing import Optional
import barcode
from barcode.writer import ImageWriter


def generate_label_image(
    product_name: str,
    barcode_value: str,
    sku: Optional[str] = None,
    vendor_name: Optional[str] = None,
    purchase_date: Optional[str] = None,
    serial_number: Optional[str] = None,
    width: int = 400,  # 4 inches at 100 DPI
    height: int = 200,  # 2 inches at 100 DPI
    dpi: int = 100
) -> str:
    """
    Generate a label image locally without external API dependency.
    Memory-optimized: uses in-memory buffers and efficient image operations.
    
    Args:
        product_name: Product name (will be truncated if too long)
        barcode_value: Barcode value to encode
        sku: SKU value (defaults to barcode_value if not provided)
        vendor_name: Vendor/Supplier name (optional, for first line)
        purchase_date: Purchase date (optional, for first line)
        serial_number: Serial number for the product (optional, for last line)
        width: Image width in pixels (default 400 = 4 inches at 100 DPI)
        height: Image height in pixels (default 200 = 2 inches at 100 DPI)
        dpi: DPI for printing (default 100)
    
    Returns:
        Base64-encoded PNG image as data URL string
    """
    # Use barcode_value as SKU if not provided
    if sku is None:
        sku = barcode_value
    
    # Truncate product name if too long
    max_name_length = 30
    if len(product_name) > max_name_length:
        product_name = product_name[:max_name_length] + '...'
    
    # Create image with white background
    img = Image.new('RGB', (width, height), color='white')
    draw = ImageDraw.Draw(img)
    
    # Try to use a nice font, fallback to default if not available
    try:
        # Try DejaVu Sans or Arial
        font_large = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 18)
        font_medium = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 14)
        font_small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 12)
    except (OSError, IOError):
        try:
            # Try Arial on Windows/Mac
            font_large = ImageFont.truetype('arial.ttf', 18)
            font_medium = ImageFont.truetype('arial.ttf', 14)
            font_small = ImageFont.truetype('arial.ttf', 12)
        except (OSError, IOError):
            # Fallback to default font
            font_large = ImageFont.load_default()
            font_medium = ImageFont.load_default()
            font_small = ImageFont.load_default()
    
    # Calculate spacing for new format (reduced margins and spacing)
    margin = 10
    # First line: Vendor Name + Purchase Date (top) - centered
    first_line_y = 8  # Reduced from margin (10) to 8
    # Barcode in middle - closer to first line
    barcode_y = first_line_y + 18  # Reduced from 22 to 18
    # Last line: Product Name + Serial (bottom) - closer to barcode
    last_line_y = height - 12  # Reduced from 20 to 12
    
    # Draw first line: Vendor Name + Purchase Date (if provided) - CENTERED
    if vendor_name or purchase_date:
        first_line_text = ""
        if vendor_name:
            # Truncate vendor name if too long
            vendor_display = vendor_name[:20] if len(vendor_name) > 20 else vendor_name
            first_line_text = vendor_display
        if purchase_date:
            if first_line_text:
                first_line_text += f" {purchase_date}"
            else:
                first_line_text = purchase_date
        # Center the first line text
        bbox = draw.textbbox((0, 0), first_line_text, font=font_medium)
        text_width = bbox[2] - bbox[0]
        first_line_x = (width - text_width) // 2
        draw.text((first_line_x, first_line_y), first_line_text, fill='black', font=font_medium)
    else:
        # Fallback: show product name on first line if no vendor info - CENTERED
        bbox = draw.textbbox((0, 0), product_name, font=font_medium)
        text_width = bbox[2] - bbox[0]
        first_line_x = (width - text_width) // 2
        draw.text((first_line_x, first_line_y), product_name, fill='black', font=font_medium)
    
    # Calculate available space for barcode (between first line and last line)
    # Reduced spacing: account for barcode text below (8px gap) and last line
    barcode_available_height = last_line_y - barcode_y - 20  # Reduced from 25 to 20
    
    try:
        # Generate Code128 barcode
        code128 = barcode.get_barcode_class('code128')
        writer = ImageWriter()
        
        # Create barcode instance
        barcode_instance = code128(barcode_value, writer=writer)
        
        # Generate barcode image - render() returns PIL Image
        # The render method accepts options as a dictionary
        barcode_img = barcode_instance.render({
            'write_text': False,  # Don't write text below barcode
            'module_width': 0.3,
            'module_height': 20.0,
            'quiet_zone': 2.0,
            'font_size': 0,
            'text_distance': 0,
            'background': 'white',
            'foreground': 'black',
        })
        
        # Get barcode image dimensions
        barcode_img_width, barcode_img_height = barcode_img.size
        
        # Calculate scaling to fit width while maintaining aspect ratio
        barcode_width = width - (2 * margin)
        scale_factor = barcode_width / barcode_img_width
        
        # Scale height proportionally, but don't exceed available space
        scaled_height = int(barcode_img_height * scale_factor)
        if scaled_height > barcode_available_height:
            scale_factor = barcode_available_height / barcode_img_height
            scaled_height = barcode_available_height
            barcode_width = int(barcode_img_width * scale_factor)
        
        # OPTIMIZATION: Use faster resampling method for shared hosting
        # LANCZOS is high quality but slow, NEAREST is fastest but lower quality
        # BILINEAR is a good middle ground for barcodes (they don't need perfect quality)
        barcode_img = barcode_img.resize(
            (barcode_width, scaled_height),
            Image.Resampling.BILINEAR  # Faster than LANCZOS, still good quality for barcodes
        )
        
        # Center barcode horizontally
        barcode_x = (width - barcode_width) // 2
        
        # Paste barcode onto label (centered)
        img.paste(barcode_img, (barcode_x, barcode_y))
        
        # Draw barcode value text BELOW the barcode (centered, with proper spacing)
        barcode_text = barcode_value
        # Get text width to center it
        bbox = draw.textbbox((0, 0), barcode_text, font=font_small)
        text_width = bbox[2] - bbox[0]
        text_x = (width - text_width) // 2
        
        # Position text below barcode with reduced spacing
        text_y = barcode_y + scaled_height + 5  # Reduced from 8px to 5px gap
        draw.text((text_x, text_y), barcode_text, fill='black', font=font_small)
        
        # Draw last line: Product Name + Serial Number - closer to barcode text
        last_line_text = product_name
        if serial_number is not None:
            last_line_text += f" #{serial_number}"
        # Center the last line text
        bbox = draw.textbbox((0, 0), last_line_text, font=font_medium)
        text_width = bbox[2] - bbox[0]
        last_line_x = (width - text_width) // 2
        # Position last line closer to barcode text (reduced gap)
        last_line_y_adjusted = text_y + 16  # Reduced gap from barcode text (was using last_line_y which was too far)
        draw.text((last_line_x, last_line_y_adjusted), last_line_text, fill='black', font=font_medium)
        
    except Exception as e:
        # If barcode generation fails, log error and draw text barcode value
        import logging
        import traceback
        logger = logging.getLogger(__name__)
        error_msg = f"Barcode generation failed for '{barcode_value}': {str(e)}"
        logger.error(error_msg)
        logger.error(traceback.format_exc())
        print(f"ERROR: {error_msg}")  # Also print to console for debugging
        # Draw text barcode value as fallback (centered)
        bbox = draw.textbbox((0, 0), f'BARCODE: {barcode_value}', font=font_small)
        text_width = bbox[2] - bbox[0]
        text_x = (width - text_width) // 2
        draw.text((text_x, barcode_y), f'BARCODE: {barcode_value}', fill='black', font=font_small)
        # Still draw last line (centered, closer to barcode)
        last_line_text = product_name
        if serial_number is not None:
            last_line_text += f" #{serial_number}"
        bbox = draw.textbbox((0, 0), last_line_text, font=font_medium)
        text_width = bbox[2] - bbox[0]
        last_line_x = (width - text_width) // 2
        last_line_y_adjusted = barcode_y + 20  # Position closer to barcode
        draw.text((last_line_x, last_line_y_adjusted), last_line_text, fill='black', font=font_medium)
    
    # OPTIMIZATION: Convert to base64 efficiently using in-memory buffer
    # Use faster compression settings for shared hosting (speed over size)
    buffer = io.BytesIO()
    # Use optimize=False and compress_level=1 for faster processing on shared hosting
    # PNG compression levels: 0-9, where 0 is fastest but larger, 9 is slowest but smallest
    # Level 1 provides good balance for shared hosting
    img.save(buffer, format='PNG', optimize=False, compress_level=1)
    buffer.seek(0)
    
    # Encode to base64
    image_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
    buffer.close()
    
    # OPTIMIZATION: Clear image from memory immediately
    img.close()
    del img
    
    return f'data:image/png;base64,{image_base64}'


def generate_single_label(zpl_code: str) -> str:
    """
    Legacy compatibility function - parses ZPL code and generates label.
    For new code, use generate_label_image() directly.
    
    Args:
        zpl_code: ZPL code string (we parse product name, SKU, and barcode from it)
    
    Returns:
        Base64-encoded PNG image as data URL string
    """
    import re
    
    # Parse ZPL code to extract information
    # Look for ^FD...^FS patterns (field data)
    field_pattern = r'\^FD([^^]+)\^FS'
    fields = re.findall(field_pattern, zpl_code)
    
    # Extract product name, SKU, and barcode from ZPL
    product_name = fields[0] if len(fields) > 0 else 'Product'
    sku_text = fields[1] if len(fields) > 1 else ''
    barcode_value = fields[2] if len(fields) > 2 else fields[0] if fields else 'UNKNOWN'
    
    # Extract SKU from "SKU: XXX" format
    sku = None
    if sku_text.startswith('SKU: '):
        sku = sku_text.replace('SKU: ', '')
    
    # Generate label using local generator
    return generate_label_image(
        product_name=product_name,
        barcode_value=barcode_value,
        sku=sku
    )

