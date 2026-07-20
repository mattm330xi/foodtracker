import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
  const barcode = url.searchParams.get('barcode');
  if (!barcode) return json({ error: 'barcode required' }, { status: 400 });

  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`);
    const data = await res.json();

    if (data.status !== 1) return json({ found: false });

    const p = data.product;
    return json({
      found: true,
      name: p.product_name || 'Unknown',
      brand: p.brands || '',
      ingredients: p.ingredients_text || '',
      allergens: p.allergens_tags?.map((a: string) => a.replace('en:', '')) || [],
      image: p.image_url || '',
    });
  } catch {
    return json({ found: false, error: 'Failed to fetch' }, { status: 500 });
  }
};
