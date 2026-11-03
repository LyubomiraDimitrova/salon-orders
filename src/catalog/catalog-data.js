import { supabase, supabaseConfigurationError } from '../services/supabase-client.js';

const productFields = [
  'id',
  'brand_id',
  'category_id',
  'article_code',
  'series_name',
  'name',
  'size_label',
  'shade_number',
  'shade_name',
  'developer_concentration',
  'image_path',
  'is_recommended',
].join(', ');

export async function loadPublicCatalog() {
  if (!supabase) {
    throw new Error(supabaseConfigurationError || 'Supabase is unavailable.');
  }

  const [productsResult, brandsResult, categoriesResult] = await Promise.all([
    supabase.from('products').select(productFields),
    supabase.from('brands').select('id, name'),
    supabase.from('product_categories').select('id, name'),
  ]);

  const failedResult = [productsResult, brandsResult, categoriesResult].find(
    ({ error }) => error,
  );

  if (failedResult) {
    throw new Error('The public catalog could not be loaded.');
  }

  return {
    products: productsResult.data || [],
    brands: brandsResult.data || [],
    categories: categoriesResult.data || [],
  };
}
