/** The synthetic USDA and Open Food Facts records scripts/mock-foods.ts serves, shared with the walk and the unit test. */
const nutrients = (cal: number, p: number, f: number, c: number, sodiumMg: number) => [
  { nutrientId: 1008, nutrientName: "Energy", unitName: "KCAL", value: cal },
  { nutrientId: 1003, nutrientName: "Protein", unitName: "G", value: p },
  { nutrientId: 1004, nutrientName: "Total lipid (fat)", unitName: "G", value: f },
  { nutrientId: 1005, nutrientName: "Carbohydrate, by difference", unitName: "G", value: c },
  { nutrientId: 1093, nutrientName: "Sodium, Na", unitName: "MG", value: sodiumMg },
];
export const records = {
  usda: [
    { fdcId: 171077, description: "CHICKEN, BROILERS OR FRYERS, BREAST, MEAT ONLY, RAW", dataType: "SR Legacy", foodCategory: "Poultry Products", foodNutrients: nutrients(120, 22.5, 2.6, 0, 45) },
    { fdcId: 331960, description: "Chicken, breast, boneless, skinless, roasted", dataType: "Foundation", foodCategory: "Poultry Products", foodNutrients: nutrients(157, 32.1, 3.2, 0, 47) },
    { fdcId: 2112345, description: "GRILLED CHICKEN BREAST STRIPS", dataType: "Branded", brandOwner: "Demo Foods Co.", foodCategory: "Prepared Meats", foodNutrients: nutrients(110, 21, 2.5, 1, 480) },
    { fdcId: 173944, description: "Apples, raw, with skin", dataType: "SR Legacy", foodCategory: "Fruits and Fruit Juices", foodNutrients: nutrients(52, 0.3, 0.2, 13.8, 1) },
  ],
  off: [
    { code: "0012345678905", product_name: "Greek Yogurt, plain", brands: "Demo Dairy, Demo Foods", categories: "Dairies, Fermented foods, Yogurts", nutriments: { "energy-kcal_100g": 59, proteins_100g: 10.2, fat_100g: 0.4, carbohydrates_100g: 3.6, sodium_100g: 0.036 } },
  ],
};

