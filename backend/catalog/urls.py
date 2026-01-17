from django.urls import path
from .views import (
    category_list_create, category_detail,
    brand_list_create, brand_detail,
    tax_rate_list_create, tax_rate_detail,
    product_list_create, product_detail,
    product_variants, product_barcodes, product_components,
    product_backfill_barcodes, product_generate_label,
    product_generate_labels, product_get_labels, product_labels_status,
    product_variant_list_create, product_variant_detail,
    barcode_list_create, barcode_detail, barcode_by_barcode,
    update_barcode_tag, bulk_update_barcode_tags,
    data_validation_check,
    defective_product_move_out, defective_product_move_out_list, defective_product_move_out_detail
)

urlpatterns = [
    # Category endpoints
    path('categories/', category_list_create, name='category-list-create'),
    path('categories/<int:pk>/', category_detail, name='category-detail'),
    
    # Brand endpoints
    path('brands/', brand_list_create, name='brand-list-create'),
    path('brands/<int:pk>/', brand_detail, name='brand-detail'),
    
    # TaxRate endpoints
    path('tax-rates/', tax_rate_list_create, name='tax-rate-list-create'),
    path('tax-rates/<int:pk>/', tax_rate_detail, name='tax-rate-detail'),
    
    # Product endpoints
    path('products/', product_list_create, name='product-list-create'),
    path('products/<int:pk>/', product_detail, name='product-detail'),
    path('products/<int:pk>/variants/', product_variants, name='product-variants'),
    path('products/<int:pk>/barcodes/', product_barcodes, name='product-barcodes'),
    path('products/<int:pk>/components/', product_components, name='product-components'),
    path('products/backfill-barcodes/', product_backfill_barcodes, name='product-backfill-barcodes'),
    path('products/generate-label/', product_generate_label, name='product-generate-label'),
    path('products/<int:pk>/generate-labels/', product_generate_labels, name='product-generate-labels'),
    path('products/<int:pk>/labels/', product_get_labels, name='product-get-labels'),
    path('products/<int:pk>/labels-status/', product_labels_status, name='product-labels-status'),
    
    # ProductVariant endpoints
    path('variants/', product_variant_list_create, name='variant-list-create'),
    path('variants/<int:pk>/', product_variant_detail, name='variant-detail'),
    
    # Barcode endpoints
    path('barcodes/', barcode_list_create, name='barcode-list-create'),
    path('barcodes/<int:pk>/', barcode_detail, name='barcode-detail'),
    path('barcodes/by-barcode/', barcode_by_barcode, name='barcode-by-barcode-query'),  # Query parameter version
    path('barcodes/by-barcode/<str:barcode>/', barcode_by_barcode, name='barcode-by-barcode'),  # Path parameter version
    path('barcodes/<int:barcode_id>/update-tag/', update_barcode_tag, name='update-barcode-tag'),
    path('barcodes/bulk-update-tags/', bulk_update_barcode_tags, name='bulk-update-barcode-tags'),
    
    # Data validation endpoints
    path('data-validation/check/', data_validation_check, name='data-validation-check'),
    
    # Defective product move-out endpoints
    path('defective-products/move-out/', defective_product_move_out, name='defective-product-move-out'),
    path('defective-products/move-outs/', defective_product_move_out_list, name='defective-product-move-out-list'),
    path('defective-products/move-outs/<int:pk>/', defective_product_move_out_detail, name='defective-product-move-out-detail'),
]
