import React, { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, Image as ImageIcon, AlertCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { SUPPORTED_FORMATS, getImageDimensions, ImageInfo } from '@/lib/imageUtils';

interface ImageUploaderProps {
  onImageUpload: (imageInfo: ImageInfo) => void;
  maxFileSize?: number;
}

export const ImageUploader: React.FC<ImageUploaderProps> = ({ 
  onImageUpload, 
  maxFileSize = 10 * 1024 * 1024 // 10MB
}) => {
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    setError('');
    
    if (acceptedFiles.length === 0) return;
    
    const file = acceptedFiles[0];
    
    // Validate file size
    if (file.size > maxFileSize) {
      setError(`File size must be less than ${Math.round(maxFileSize / (1024 * 1024))}MB`);
      return;
    }

    // Validate file type
    if (!SUPPORTED_FORMATS.includes(file.type as any)) {
      setError('Unsupported file format. Please use JPG, PNG, WebP, SVG, GIF, or ICO files.');
      return;
    }

    setIsLoading(true);
    
    try {
      const dimensions = await getImageDimensions(file);
      const url = URL.createObjectURL(file);
      
      const imageInfo: ImageInfo = {
        file,
        url,
        size: file.size,
        format: file.type,
        width: dimensions.width,
        height: dimensions.height
      };
      
      onImageUpload(imageInfo);
    } catch (err) {
      setError('Failed to process image. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [maxFileSize, onImageUpload]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.svg', '.gif', '.ico']
    },
    maxFiles: 1,
    disabled: isLoading
  });

  return (
    <div className="w-full max-w-2xl mx-auto">
      <Card>
        <CardContent className="p-6">
          <div
            {...getRootProps()}
            className={`
              border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
              ${isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'}
              ${isLoading ? 'opacity-50 cursor-not-allowed' : 'hover:border-primary hover:bg-accent/50'}
            `}
          >
            <input {...getInputProps()} />
            
            <div className="flex flex-col items-center gap-4">
              {isLoading ? (
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
              ) : (
                <div className="p-3 rounded-full bg-primary/10">
                  {isDragActive ? (
                    <ImageIcon className="h-8 w-8 text-primary" />
                  ) : (
                    <Upload className="h-8 w-8 text-primary" />
                  )}
                </div>
              )}
              
              <div className="space-y-2">
                <h3 className="text-lg font-semibold">
                  {isLoading ? 'Processing...' : isDragActive ? 'Drop your image here' : 'Upload an image'}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {isLoading ? 'Please wait while we process your image' : 'Drag & drop or click to select (max 10MB)'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Supports: JPG, PNG, WebP, SVG, GIF, ICO
                </p>
              </div>
              
              {!isLoading && (
                <Button variant="outline" className="mt-2">
                  Choose File
                </Button>
              )}
            </div>
          </div>
          
          {error && (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
};