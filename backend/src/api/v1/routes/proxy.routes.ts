import { Router } from 'express';
import axios from 'axios';

interface IPFSMetadata {
  image?: string;
  logo?: string;  // Some tokens use 'logo' instead of 'image'
  imageUri?: string;  // Handle variations
  logo_uri?: string;
}

const isImageResponse = (contentType: string) => {
  return contentType.startsWith('image/');
};

const extractImageUrlFromMetadata = async (url: string): Promise<string | null> => {
  try {
    // Try to fetch the URL first
    const response = await axios.get(url, { 
      timeout: 5000,
      validateStatus: null // Accept any status code
    });

    // If it's already an image, return the URL as is
    if (response.headers['content-type'] && isImageResponse(response.headers['content-type'])) {
      console.log('URL is already an image:', url);
      return url;
    }

    // If it's JSON, try to parse it as metadata
    if (response.headers['content-type']?.includes('application/json')) {
      console.log('Found JSON metadata:', response.data);
      const metadata = response.data as IPFSMetadata;
      const imageUrl = metadata.image || metadata.logo || metadata.imageUri || metadata.logo_uri;

      if (!imageUrl) {
        console.error('No image URL found in metadata:', metadata);
        return null;
      }

      // If the image URL is a relative IPFS path, make it absolute
      if (imageUrl.startsWith('ipfs://')) {
        return `https://ipfs.io/ipfs/${imageUrl.replace('ipfs://', '')}`;
      }

      return imageUrl;
    }

    console.error('Response is neither an image nor JSON metadata:', response.headers['content-type']);
    return null;
  } catch (error) {
    console.error('Error fetching URL:', error);
    return null;
  }
};

export const createProxyRouter = () => {
  const router = Router();

  router.get('/image', async (req, res) => {
    try {
      const imageUrl = req.query.url as string;
      if (!imageUrl) {
        return res.status(400).json({ error: 'No URL provided' });
      }

      // Get the actual image URL
      const actualImageUrl = await extractImageUrlFromMetadata(imageUrl);
      if (!actualImageUrl) {
        return res.status(404).json({ error: 'Image not found' });
      }

      console.log(`Fetching image from: ${actualImageUrl}`);
      const response = await axios.get(actualImageUrl, {
        responseType: 'arraybuffer',
        timeout: 5000,
        headers: {
          'Accept': 'image/*'
        }
      });

      if (!isImageResponse(response.headers['content-type'])) {
        console.error('Response is not an image:', response.headers['content-type']);
        return res.status(400).json({ error: 'URL did not return an image' });
      }

      // Set appropriate headers
      res.set('Content-Type', response.headers['content-type']);
      res.set('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
      res.set('Access-Control-Allow-Origin', '*');
      
      res.send(response.data);
    } catch (error) {
      console.error('Image proxy error:', error);
      res.status(500).json({ error: 'Failed to fetch image' });
    }
  });

  // Add endpoint to just get the actual image URL
  router.get('/resolve-image-url', async (req, res) => {
    try {
      const url = req.query.url as string;
      if (!url) {
        return res.status(400).json({ error: 'No URL provided' });
      }

      const actualImageUrl = await extractImageUrlFromMetadata(url);
      if (!actualImageUrl) {
        return res.status(404).json({ error: 'Image URL not found' });
      }

      res.json({ imageUrl: actualImageUrl });
    } catch (error) {
      console.error('Error resolving image URL:', error);
      res.status(500).json({ error: 'Failed to resolve image URL' });
    }
  });

  return router;
}; 