import React, { useState } from 'react';
import { ImageUploader } from '@/components/ImageUploader';
import { ImageProcessor } from '@/components/ImageProcessor';
import { ImageInfo } from '@/lib/imageUtils';
import { Zap, Image as ImageIcon, Sparkles } from 'lucide-react';

const Index = () => {
  const [currentImage, setCurrentImage] = useState<ImageInfo | null>(null);

  const handleImageUpload = (imageInfo: ImageInfo) => {
    setCurrentImage(imageInfo);
  };

  const handleReset = () => {
    if (currentImage?.url) {
      URL.revokeObjectURL(currentImage.url);
    }
    setCurrentImage(null);
  };

  return (
    <div className="min-h-screen bg-linear-to-br from-background via-background to-muted/20">
      {/* Header */}
      <div className="container mx-auto px-4 py-8">
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="p-3 rounded-full bg-primary/10">
              <Zap className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-4xl font-bold bg-linear-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              Speedy Image Crunch
            </h1>
          </div>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Compress and convert your images instantly with zero quality loss. 
            Fast, secure, and completely free.
          </p>
          
          {/* Features */}
          <div className="flex flex-wrap justify-center gap-6 mt-8 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <ImageIcon className="h-4 w-4" />
              <span>Multiple formats supported</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Sparkles className="h-4 w-4" />
              <span>Lossless compression</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Zap className="h-4 w-4" />
              <span>Instant processing</span>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex justify-center">
          {!currentImage ? (
            <ImageUploader onImageUpload={handleImageUpload} />
          ) : (
            <ImageProcessor 
              imageInfo={currentImage} 
              onReset={handleReset}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default Index;
