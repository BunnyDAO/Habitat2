import { Router } from 'express';

const router = Router();

router.get('/metadata-image/:uri(*)', async (req, res) => {
    try {
        const { uri } = req.params;
        console.log('Resolving metadata image for URI:', uri);

        // Try to fetch and parse as JSON first
        const response = await fetch(uri);
        const text = await response.text();
        
        try {
            const data = JSON.parse(text);
            console.log('Successfully parsed JSON:', data);
            
            if (data.image) {
                console.log('Found image URL:', data.image);
                return res.json({ imageUrl: data.image });
            }
        } catch (parseError) {
            console.log('Failed to parse JSON:', parseError);
        }

        // If not JSON or no image field, return the original URI
        return res.json({ imageUrl: uri });
    } catch (error) {
        console.error('Error resolving metadata image:', error);
        return res.status(500).json({ error: 'Failed to resolve metadata image' });
    }
});

export default router; 