import React, { useState, useEffect } from 'react';
import { Download, Settings, Zap, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { 
  ImageInfo, 
  CompressedImageResult, 
  compressImage, 
  convertImageFormat, 
  formatFileSize, 
  downloadBlob,
  FORMAT_EXTENSIONS 
} from '@/lib/imageUtils';

interface ImageProcessorProps {
  imageInfo: ImageInfo;
  onReset: () => void;
}

const formatOptions = [
  { value: 'image/jpeg', label: 'JPG' },
  { value: 'image/png', label: 'PNG' },
  { value: 'image/webp', label: 'WebP' },
  { value: 'image/gif', label: 'GIF' }
];

export const ImageProcessor: React.FC<ImageProcessorProps> = ({ imageInfo, onReset }) => {
  const [quality, setQuality] = useState([85]);
  const [targetFormat, setTargetFormat] = useState(imageInfo.format);
  const [compressedResult, setCompressedResult] = useState<CompressedImageResult | null>(null);
  const [convertedBlob, setConvertedBlob] = useState<Blob | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  // Auto-compress when quality changes
  useEffect(() => {
    const processImage = async () => {
      if (!imageInfo) return;
      
      setIsProcessing(true);
      try {
        const result = await compressImage(
          imageInfo.file,
          quality[0] / 100,
          1920, // max width
          1920  // max height
        );
        setCompressedResult(result);
      } catch (error) {
        toast({
          title: "Compression failed",
          description: "Failed to compress image. Please try again.",
          variant: "destructive"
        });
      } finally {
        setIsProcessing(false);
      }
    };

    processImage();
  }, [imageInfo, quality, toast]);

  // Convert format when target format changes
  useEffect(() => {
    const convertFormat = async () => {
      if (!compressedResult || targetFormat === imageInfo.format) {
        setConvertedBlob(null);
        return;
      }

      setIsProcessing(true);
      try {
        const blob = await convertImageFormat(
          imageInfo.file,
          targetFormat,
          quality[0] / 100
        );
        setConvertedBlob(blob);
      } catch (error) {
        toast({
          title: "Conversion failed", 
          description: "Failed to convert image format. Please try again.",
          variant: "destructive"
        });
      } finally {
        setIsProcessing(false);
      }
    };

    convertFormat();
  }, [targetFormat, imageInfo, compressedResult, quality, toast]);

  const handleDownload = () => {
    const finalBlob = convertedBlob || compressedResult?.blob;
    if (!finalBlob) return;

    const extension = FORMAT_EXTENSIONS[targetFormat as keyof typeof FORMAT_EXTENSIONS];
    const baseName = imageInfo.file.name.split('.')[0];
    const filename = `${baseName}_compressed.${extension}`;
    
    downloadBlob(finalBlob, filename);
    
    toast({
      title: "Download started",
      description: `Your compressed image is downloading as ${filename}`,
    });
  };

  const finalSize = convertedBlob?.size || compressedResult?.size || 0;
  const totalSavings = ((imageInfo.size - finalSize) / imageInfo.size) * 100;

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6">
      {/* Image Comparison */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Original Image */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Original
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="aspect-video bg-muted rounded-lg overflow-hidden">
                <img 
                  src={imageInfo.url} 
                  alt="Original" 
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <Label className="text-muted-foreground">Size</Label>
                  <p className="font-medium">{formatFileSize(imageInfo.size)}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Dimensions</Label>
                  <p className="font-medium">{imageInfo.width} × {imageInfo.height}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Format</Label>
                  <p className="font-medium">{imageInfo.format.split('/')[1].toUpperCase()}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Processed Image */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              Compressed
              {isProcessing && <RefreshCw className="h-4 w-4 animate-spin" />}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="aspect-video bg-muted rounded-lg overflow-hidden">
                {compressedResult && (
                  <img 
                    src={convertedBlob ? URL.createObjectURL(convertedBlob) : compressedResult.url} 
                    alt="Compressed" 
                    className="w-full h-full object-contain"
                  />
                )}
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <Label className="text-muted-foreground">Size</Label>
                  <p className="font-medium">{formatFileSize(finalSize)}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Savings</Label>
                  <Badge variant={totalSavings > 0 ? "default" : "secondary"}>
                    {totalSavings.toFixed(1)}%
                  </Badge>
                </div>
                <div>
                  <Label className="text-muted-foreground">Format</Label>
                  <p className="font-medium">{targetFormat.split('/')[1].toUpperCase()}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Controls */}
      <Card>
        <CardHeader>
          <CardTitle>Compression Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            {/* Quality Slider */}
            <div className="space-y-3">
              <Label>Quality: {quality[0]}%</Label>
              <Slider
                value={quality}
                onValueChange={setQuality}
                max={100}
                min={10}
                step={5}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground">
                Lower quality = smaller file size
              </p>
            </div>

            {/* Format Selector */}
            <div className="space-y-3">
              <Label>Output Format</Label>
              <Select value={targetFormat} onValueChange={setTargetFormat}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {formatOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3">
            <Button 
              onClick={handleDownload}
              disabled={!compressedResult || isProcessing}
              className="flex-1 min-w-[150px]"
            >
              <Download className="h-4 w-4 mr-2" />
              Download Compressed
            </Button>
            
            <Button 
              variant="outline" 
              onClick={onReset}
              className="flex-1 min-w-[150px]"
            >
              Upload New Image
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};