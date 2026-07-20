import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
  const barcode = url.searchParams.get('barcode');
  if (!barcode) return json({ error: 'barcode required' }, { status: 400 });

  console.log(`[barcode] Looking up: ${barcode}`);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await res.json();

    if (data.status !== 1) {
      console.log(`[barcode] Not found: ${barcode}`);
      return json({ found: false });
    }

    const p = data.product;
    console.log(`[barcode] Found: ${p.product_name || 'Unknown'}`);
    return json({
      found: true,
      name: p.product_name || 'Unknown',
      brand: p.brands || '',
      ingredients: p.ingredients_text || '',
      allergens: p.allergens_tags?.map((a: string) => a.replace('en:', '')) || [],
      image: p.image_url || '',
    });
  } catch (e: any) {
    const msg = e?.name === 'AbortError' ? 'Lookup timed out (server 15s limit)' : `Failed to fetch: ${e?.message || e}`;
    console.error(`[barcode] Error for ${barcode}:`, msg);
    return json({ found: false, error: msg }, { status: 500 });
  }
};
