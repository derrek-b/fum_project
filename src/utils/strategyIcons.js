/**
 * Strategy icon mapping
 * Maps icon names from strategy configs to lucide-react components.
 * This avoids importing the entire lucide-react library.
 */
import { Ban, Footprints, Dumbbell, Banknote } from 'lucide-react';

const strategyIcons = {
  Ban,
  Footprints,
  Dumbbell,
  Banknote
};

/**
 * Get a lucide icon component by name
 * @param {string} iconName - Name of the icon (e.g., 'Ban', 'Steps')
 * @returns {React.ComponentType|null} The icon component or null if not found
 */
export function getStrategyIcon(iconName) {
  return strategyIcons[iconName] || null;
}

export default strategyIcons;
