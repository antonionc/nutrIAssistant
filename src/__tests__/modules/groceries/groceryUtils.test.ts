import { inferGroceryCategory } from '../../../modules/groceries/groceryUtils'

describe('inferGroceryCategory', () => {
  it.each([
    ['tomato', 'fruits_vegetables'],
    ['cherry tomatoes', 'fruits_vegetables'],
    ['spinach', 'fruits_vegetables'],
    ['broccoli', 'fruits_vegetables'],
    ['apple', 'fruits_vegetables'],
    ['banana', 'fruits_vegetables'],
    ['avocado', 'fruits_vegetables'],
    ['potato', 'fruits_vegetables'],
  ])('categorises %s as fruits_vegetables', (name, expected) => {
    expect(inferGroceryCategory(name)).toBe(expected)
  })

  it.each([
    ['chicken breast', 'proteins'],
    ['salmon fillet', 'proteins'],
    ['ground beef', 'proteins'],
    ['lentils', 'proteins'],
    ['chickpeas', 'proteins'],
    ['tofu block', 'proteins'],
    ['eggs', 'proteins'],
  ])('categorises %s as proteins', (name, expected) => {
    expect(inferGroceryCategory(name)).toBe(expected)
  })

  it.each([
    ['whole milk', 'dairy_alternatives'],
    ['cheddar cheese', 'dairy_alternatives'],
    ['greek yogurt', 'dairy_alternatives'],
    ['mozzarella', 'dairy_alternatives'],
    ['butter', 'dairy_alternatives'],
  ])('categorises %s as dairy_alternatives', (name, expected) => {
    expect(inferGroceryCategory(name)).toBe(expected)
  })

  it.each([
    ['white bread', 'grains_pantry'],
    ['whole wheat pasta', 'grains_pantry'],
    ['brown rice', 'grains_pantry'],
    ['oat flakes', 'grains_pantry'],
    ['quinoa', 'grains_pantry'],
    ['flour', 'grains_pantry'],
  ])('categorises %s as grains_pantry', (name, expected) => {
    expect(inferGroceryCategory(name)).toBe(expected)
  })

  it.each([
    ['olive oil', 'other'],
    ['salt', 'other'],
    ['cinnamon', 'other'],
    ['oregano', 'other'],
    ['balsamic vinegar', 'other'],
    ['xyzunknown', 'other'],
  ])('categorises %s as other when no category matches', (name, expected) => {
    expect(inferGroceryCategory(name)).toBe(expected)
  })

  it('is case-insensitive', () => {
    expect(inferGroceryCategory('TOMATO')).toBe('fruits_vegetables')
    expect(inferGroceryCategory('Chicken')).toBe('proteins')
    expect(inferGroceryCategory('MILK')).toBe('dairy_alternatives')
  })
})
