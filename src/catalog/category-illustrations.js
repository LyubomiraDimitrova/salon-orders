import shampoo from '../assets/product-illustrations/shampoo.svg';
import mask from '../assets/product-illustrations/mask.svg';
import conditioner from '../assets/product-illustrations/conditioner.svg';
import hairDye from '../assets/product-illustrations/hair-dye.svg';
import developer from '../assets/product-illustrations/developer.svg';
import stylingSpray from '../assets/product-illustrations/styling-spray.svg';
import fallback from '../assets/product-illustrations/fallback.svg';

const categoryIllustrationRules = [
  { illustration: shampoo, terms: ['шампоан', 'shampoo'] },
  { illustration: mask, terms: ['маска', 'mask'] },
  { illustration: conditioner, terms: ['балсам', 'conditioner'] },
  { illustration: hairDye, terms: ['боя', 'оцвет', 'hair dye', 'dye', 'colour', 'color', 'toner'] },
  { illustration: developer, terms: ['оксидант', 'окислител', 'developer', 'oxidant', 'emulsion'] },
  { illustration: stylingSpray, terms: ['стилиз', 'лак', 'фиксаж', 'спрей', 'styling', 'spray', 'mousse', 'gel', 'wax'] },
];

function normaliseCategoryName(categoryName) {
  return String(categoryName || '')
    .trim()
    .toLocaleLowerCase('bg')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function getCategoryIllustration(categoryName) {
  const normalizedName = normaliseCategoryName(categoryName);
  const matchedRule = categoryIllustrationRules.find(({ terms }) => terms.some((term) => normalizedName.includes(term)));

  return matchedRule?.illustration || fallback;
}
