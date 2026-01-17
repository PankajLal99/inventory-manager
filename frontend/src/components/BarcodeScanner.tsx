import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, CameraOff } from 'lucide-react';
import Button from './ui/Button';

interface BarcodeScannerProps {
  onScan: (barcode: string) => Promise<void> | void;
  onClose: () => void;
  isOpen: boolean;
  continuous?: boolean;
}

export default function BarcodeScanner({ 
  onScan, 
  onClose, 
  isOpen, 
  continuous = false,
}: BarcodeScannerProps) {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerId = 'barcode-scanner-viewfinder';
  const isStartingRef = useRef(false);
  
  // Track recently scanned barcodes to prevent duplicate processing
  const recentlyScannedRef = useRef<Map<string, number>>(new Map());
  const isProcessingRef = useRef(false);
  const lastScanTimeRef = useRef<number>(0);
  
  // Debounce period: don't process the same barcode within 2 seconds
  const SCAN_DEBOUNCE_MS = 2000;
  // Minimum time between any scans: 500ms
  const MIN_SCAN_INTERVAL_MS = 500;

  useEffect(() => {
    if (!isOpen) {
      stopScanning();
      return;
    }

    // Auto-start scanning when opened
    const timer = setTimeout(() => {
      if (!isStartingRef.current && !scanning) {
        startScanning();
      }
    }, 100);

    return () => {
      clearTimeout(timer);
      stopScanning();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const onScanRef = useRef(onScan);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  // Handle barcode scan processing (shared between continuous and tap-to-scan)
  const handleBarcodeScan = async (trimmedBarcode: string) => {
    // Skip empty barcodes
    if (!trimmedBarcode) {
      return;
    }
    
    // Throttle: Don't process if we're already processing a scan
    if (isProcessingRef.current) {
      return;
    }
    
    // Rate limiting: Don't process scans too frequently
    const now = Date.now();
    const timeSinceLastScan = now - lastScanTimeRef.current;
    if (timeSinceLastScan < MIN_SCAN_INTERVAL_MS) {
      return;
    }
    
    // Debounce: Don't process the same barcode within the debounce period
    const lastScanTime = recentlyScannedRef.current.get(trimmedBarcode);
    if (lastScanTime && (now - lastScanTime) < SCAN_DEBOUNCE_MS) {
      return;
    }
    
    // Mark as processing and update last scan time
    isProcessingRef.current = true;
    lastScanTimeRef.current = now;
    recentlyScannedRef.current.set(trimmedBarcode, now);
    
    // Clean up old entries from the map (keep only last 50 entries)
    if (recentlyScannedRef.current.size > 50) {
      const entries = Array.from(recentlyScannedRef.current.entries());
      // Keep the 25 most recent entries
      const recentEntries = entries
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25);
      recentlyScannedRef.current = new Map(recentEntries);
    }
    
    try {
      await onScanRef.current(trimmedBarcode);
      // Only stop if not continuous and scan was successful
      if (!continuous) {
        stopScanning();
        onClose();
      }
    } catch (err: any) {
      // Show error to user
      const errorMessage = err?.message || err?.response?.data?.message || err?.response?.data?.error || 'Failed to process barcode scan';
      setError(errorMessage);
      // Clear error after 5 seconds
      setTimeout(() => {
        setError(null);
      }, 5000);
      // Don't stop scanning on error if continuous mode - let user try again
      if (!continuous) {
        stopScanning();
        onClose();
      }
    } finally {
      // Reset processing flag after a short delay to allow next scan
      setTimeout(() => {
        isProcessingRef.current = false;
      }, 300);
    }
  };

  // Tap-to-scan: capture current frame and scan it
  const captureAndScan = async () => {
    if (!scannerRef.current || !scanning || isCapturing || isProcessingRef.current) {
      return;
    }

    try {
      setIsCapturing(true);
      
      // Find the video element inside the scanner
      const element = document.getElementById(scannerId);
      if (!element) {
        throw new Error('Scanner element not found');
      }

      const video = element.querySelector('video') as HTMLVideoElement;
      if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) {
        throw new Error('Video not ready');
      }

      // Create a canvas to capture the frame
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Could not get canvas context');
      }

      // Draw video frame to canvas
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Convert canvas to blob/file
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to create blob'));
          }
        }, 'image/png');
      });

      // Create a File object from blob
      const file = new File([blob], 'capture.png', { type: 'image/png' });

      // Scan the captured image using scanFile
      try {
        const result = await scannerRef.current.scanFile(file, false);
        if (result) {
          const trimmedBarcode = result.trim();
          if (trimmedBarcode) {
            // Process the scanned barcode
            await handleBarcodeScan(trimmedBarcode);
          }
        }
      } catch (scanError: any) {
        // Ignore scan errors (no barcode found) - that's normal
        if (scanError && !scanError.message?.includes('No QR code')) {
          console.debug('Scan error:', scanError);
        }
      }
    } catch (err: any) {
      console.error('Capture error:', err);
      // Don't show error to user for tap-to-scan failures
    } finally {
      setIsCapturing(false);
    }
  };

  const startScanning = async () => {
    if (isStartingRef.current || scanning || scannerRef.current) {
      return;
    }

    // Detect if device is mobile (needed for config)
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
                     (window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
    
    // Detect orientation (portrait vs landscape)
    const isPortrait = window.innerHeight > window.innerWidth;

    // Helper function to create scan config (reusable for fallback)
    // Defined outside try block so it's accessible in catch block
    // Optimized for QR codes (square, compact) on all devices
    const createScanConfig = () => ({
        // Higher FPS for better QR code scanning
        fps: isMobile ? (isPortrait ? 20 : 15) : 10,
        qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
          // QR codes are square - use square scanning area on all devices
          const minDimension = Math.min(viewfinderWidth, viewfinderHeight);
          const qrSize = Math.floor(minDimension * 0.75); // 75% of smaller dimension for square QR box
          
          return {
            width: qrSize,
            height: qrSize
          };
        },
        // QR codes work best with square viewfinder (1:1 aspect ratio)
        aspectRatio: 1 // Square (1:1) for QR codes on all devices
      });

    try {
      isStartingRef.current = true;
      setError(null);
      
      if (scannerRef.current) {
        await stopScanning();
      }

      const element = document.getElementById(scannerId);
      if (!element) {
        throw new Error('Scanner element not found');
      }

      element.innerHTML = '';

      setScanning(true);
      const html5QrCode = new Html5Qrcode(scannerId);
      scannerRef.current = html5QrCode;
      
      // For mobile: Configure to prefer QR codes (more reliable than barcodes on mobile)
      if (isMobile) {
        // html5-qrcode scans both QR codes and barcodes by default
        // But we can optimize the scanning area for QR codes (square, centered)
        // The library will still scan barcodes if present, but QR codes work better
      }

      // Try to find the best camera
      // Note: html5-qrcode doesn't support width/height in cameraConfig, so we only use deviceId or facingMode
      let cameraConfig: { facingMode?: string; deviceId?: string } = {};
      
      if (isMobile) {
        // On mobile: explicitly find and use back camera
        try {
          // Request camera permission first (needed for device enumeration)
          // Try high quality first, but fallback to basic if it fails
          let stream: MediaStream | null = null;
          try {
            // Try with high quality constraints first
            stream = await navigator.mediaDevices.getUserMedia({ 
              video: { 
                facingMode: 'environment',
                width: { ideal: 1920, min: 640 }, // Request high resolution, but allow lower
                height: { ideal: 1080, min: 480 }
              } 
            });
          } catch (highQualityError) {
            // If high quality fails, try basic (no constraints)
            console.debug('High quality stream failed, trying basic:', highQualityError);
            stream = await navigator.mediaDevices.getUserMedia({ 
              video: { facingMode: 'environment' } 
            });
          }
          
          // Stop the temporary stream
          if (stream) {
            stream.getTracks().forEach(track => track.stop());
          }
          
          // Now enumerate devices to find back camera
          const devices = await navigator.mediaDevices.enumerateDevices();
          const videoDevices = devices.filter(device => device.kind === 'videoinput');
          
          // Find back camera - look for device with label containing "back" or "rear"
          // or use the last device (often the back camera on mobile)
          const backCamera = videoDevices.find(device => {
            const label = device.label.toLowerCase();
            return label.includes('back') || label.includes('rear') || label.includes('environment');
          }) || videoDevices[videoDevices.length - 1]; // Fallback to last device (usually back camera)
          
          if (backCamera && backCamera.deviceId) {
            // Use explicit deviceId for back camera
            // html5-qrcode will use the device, browser should use high quality if available
            cameraConfig = { deviceId: backCamera.deviceId };
          } else {
            // Fallback to facingMode if deviceId not available
            cameraConfig = { facingMode: 'environment' };
          }
        } catch (enumError: any) {
          // If enumeration fails, use facingMode as fallback
          console.debug('Camera enumeration failed:', enumError);
          cameraConfig = { facingMode: 'environment' };
        }
      } else {
        // On desktop/laptop: use environment (default webcam)
        cameraConfig = { facingMode: 'environment' };
      }

      const scanConfig = createScanConfig();

      // For mobile devices, try to ensure high quality by using videoConstraints
      // html5-qrcode's start() method accepts videoConstraints as part of config
      // We'll pass it through the scanConfig if possible, but the library handles it internally
      // The key is that we already requested high quality during enumeration
      
      await html5QrCode.start(
        cameraConfig,
        scanConfig,
        async (decodedText) => {
          await handleBarcodeScan(decodedText.trim());
        },
        (_errorMessage) => {
          // Scanning in progress, ignore minor errors
          // Only log for debugging (commented out to reduce console noise)
          // console.debug('Scanning in progress:', _errorMessage);
        }
      );
      isStartingRef.current = false;
    } catch (err: any) {
      console.error('Camera start error:', err);
      
      // Enhanced error handling with specific error types
      if (err.name === 'NotAllowedError' || err.message?.includes('permission') || err.message?.includes('Permission denied')) {
        setError('Camera permission denied. Please allow camera access in your browser settings and try again.');
        setScanning(false);
        isStartingRef.current = false;
        scannerRef.current = null;
        return;
      }
      
      if (err.name === 'NotFoundError' || err.message?.includes('no camera') || err.message?.includes('not found')) {
        setError('No camera found. Please ensure your device has a camera and try again.');
        setScanning(false);
        isStartingRef.current = false;
        scannerRef.current = null;
        return;
      }
      
      if (err.name === 'NotReadableError' || err.message?.includes('NotReadableError')) {
        setError('Camera is already in use by another application. Please close other apps using the camera and try again.');
        setScanning(false);
        isStartingRef.current = false;
        scannerRef.current = null;
        return;
      }
      
      // If environment camera fails, try user camera as fallback
      // This is mainly for desktop where some webcams might not support environment
      if (err.message && (err.message.includes('environment') || err.message.includes('NotReadableError'))) {
        try {
          const html5QrCode = scannerRef.current;
          if (html5QrCode) {
            // Use same optimized config for fallback
            await html5QrCode.start(
              { facingMode: 'user' }, // Fallback to user camera
              createScanConfig(),
              async (decodedText) => {
                await handleBarcodeScan(decodedText.trim());
              },
              () => {
                // Scanning in progress, ignore errors
              }
            );
            isStartingRef.current = false;
            return;
          }
        } catch (fallbackErr: any) {
          // Both failed, show detailed error
          console.error('Fallback camera also failed:', fallbackErr);
          let errorMessage = 'Failed to start camera. ';
          if (fallbackErr.name === 'NotAllowedError') {
            errorMessage += 'Please allow camera access in your browser settings.';
          } else if (fallbackErr.name === 'NotFoundError') {
            errorMessage += 'No camera found on your device.';
          } else {
            errorMessage += 'Please ensure camera permissions are granted and try again.';
          }
          setError(errorMessage);
          setScanning(false);
          isStartingRef.current = false;
          scannerRef.current = null;
        }
      } else {
        // Generic error with helpful message
        let errorMessage = 'Failed to start camera. ';
        if (err.name === 'NotAllowedError') {
          errorMessage += 'Please allow camera access in your browser settings.';
        } else if (err.name === 'NotFoundError') {
          errorMessage += 'No camera found on your device.';
        } else {
          errorMessage += 'Please ensure camera permissions are granted and try again.';
        }
        setError(errorMessage);
        setScanning(false);
        isStartingRef.current = false;
        scannerRef.current = null;
      }
    }
  };

  const stopScanning = async () => {
    isStartingRef.current = false;
    isProcessingRef.current = false;
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop().catch(() => {});
        scannerRef.current.clear();
      } catch (err) {
      }
      scannerRef.current = null;
    }
    setScanning(false);
    
    // Clear recently scanned cache when stopping
    recentlyScannedRef.current.clear();
    lastScanTimeRef.current = 0;
    
    const element = document.getElementById(scannerId);
    if (element) {
      element.innerHTML = '';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="w-full space-y-2 flex flex-col items-center">
      <style>{`
        #${scannerId} video {
          width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
          /* Preserve video quality - prevent browser downscaling */
          image-rendering: -webkit-optimize-contrast;
          image-rendering: crisp-edges;
          /* Force hardware acceleration for better quality */
          -webkit-transform: translateZ(0);
          transform: translateZ(0);
          will-change: transform;
          /* Prevent quality degradation */
          -webkit-backface-visibility: hidden;
          backface-visibility: hidden;
        }
        #${scannerId} canvas {
          display: none !important;
        }
      `}</style>
      <div
        id={scannerId}
        className={`mx-auto rounded-lg overflow-hidden bg-gray-100 border border-gray-300 relative ${
          scanning ? 'cursor-pointer' : ''
        } ${isCapturing ? 'ring-4 ring-blue-500 ring-opacity-75' : ''}`}
        style={{ 
          // QR codes are square and compact - use smaller, square viewfinder
          width: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
                 (window.matchMedia && window.matchMedia('(max-width: 768px)').matches)
            ? (window.innerHeight > window.innerWidth ? '280px' : '320px') // Mobile: narrower for QR codes
            : '320px', // Desktop: narrower square for QR codes
          height: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
                  (window.matchMedia && window.matchMedia('(max-width: 768px)').matches)
            ? (window.innerHeight > window.innerWidth ? '280px' : '320px') // Square for QR codes
            : '320px', // Desktop: square for QR codes
          minWidth: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
                    (window.matchMedia && window.matchMedia('(max-width: 768px)').matches)
            ? (window.innerHeight > window.innerWidth ? '280px' : '320px')
            : '320px',
          minHeight: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
                     (window.matchMedia && window.matchMedia('(max-width: 768px)').matches)
            ? (window.innerHeight > window.innerWidth ? '280px' : '320px')
            : '320px'
        }}
        onClick={async (e) => {
          // Tap-to-scan: only when scanning is active
          if (scanning && !isCapturing && !isProcessingRef.current) {
            e.preventDefault();
            await captureAndScan();
          }
        }}
        title={scanning ? 'Tap to scan QR code' : undefined}
      >
        {isCapturing && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-10 rounded-lg">
            <div className="bg-white rounded-lg p-3 flex items-center gap-2">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
              <span className="text-sm font-medium text-gray-700">Scanning...</span>
            </div>
          </div>
        )}
      </div>
      
      {error && (
        <div className="p-2 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      <div className="flex gap-2">
        {scanning ? (
          <>
            <Button 
              onClick={stopScanning} 
              variant="outline" 
              size="sm"
              className="flex-1"
            >
              <CameraOff className="h-4 w-4 mr-2" />
              Stop Camera
            </Button>
            <Button 
              onClick={onClose} 
              variant="outline" 
              size="sm"
              className="flex-1"
            >
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button 
              onClick={startScanning} 
              variant="outline" 
              size="sm"
              className="flex-1"
            >
              <Camera className="h-4 w-4 mr-2" />
              Start Camera
            </Button>
            <Button 
              onClick={onClose} 
              variant="outline" 
              size="sm"
              className="flex-1"
            >
              Cancel
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
