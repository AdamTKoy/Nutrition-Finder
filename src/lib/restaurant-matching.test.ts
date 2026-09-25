import { describe, expect, it } from "vitest";
import { matchesRestaurantChain } from "./restaurant-matching";

// protects both side of matching policy: 
// accept known variations and reject addt'l words that might ID another business
describe("matchesRestaurantChain", () => {
  it.each([
    ["McDonald's", "McDonald’s"],
    ["  BURGER KING  ", "Burger King"],
    ["Chick-fil-A", "Chick fil A"],
    ["Chipotle", "Chipotle Mexican Grill"],
    ["Chipotle Mexican Grill", "Chipotle"],
    ["KFC", "Kentucky Fried Chicken"],
  ])("accepts %s as a match for %s", (chain, place) => {
    expect(matchesRestaurantChain(chain, place)).toBe(true);
  });

  it.each([
    ["Burger King", "Burger Kingdom"],
    ["Subway", "Subway Cafe"],
    ["Chipotle", "Chipotle Mexican Grill Catering"],
    ["KFC", "Kentucky Fried Chicken Museum"],
    ["", "Chipotle"],
    ["Chipotle", ""],
    ["!!!", "???"],
  ])("rejects %s as a match for %s", (chain, place) => {
    expect(matchesRestaurantChain(chain, place)).toBe(false);
  });
});