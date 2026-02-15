// src/components/PlatformFilter.js
import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { ButtonGroup, Button, Badge } from 'react-bootstrap';

// FUM Library imports
import { getPlatformMetadata, getPlatformName, getPlatformColor } from 'fum_library/helpers/platformHelpers';

// Local project imports
import { setPlatformFilter } from '../../redux/platformsSlice';
import { useToast } from '../../context/ToastContext';

export default function PlatformFilter() {
  const dispatch = useDispatch();
  const { showError } = useToast();
  const { activePlatforms, platformFilter } = useSelector(state => state.platforms);
  const positions = useSelector(state => state.positions.positions || []);

  // If there are no active platforms or no positions, don't render the filter
  if (!activePlatforms || activePlatforms.length <= 1 || !positions.length) {
    return null;
  }

  // Set the filter to a specific platform or null (show all)
  const setFilter = (platformId) => {
    try {
      dispatch(setPlatformFilter(platformId === 'all' ? null : platformId));
    } catch (error) {
      console.error("Error setting platform filter:", error);
      showError("Failed to set platform filter. Please try again.");
    }
  };

  // Count positions by platform
  const platformCounts = {};
  try {
    positions.forEach(position => {
      if (position.platform) {
        platformCounts[position.platform] = (platformCounts[position.platform] || 0) + 1;
      }
    });
  } catch (error) {
    console.error("Error counting positions by platform:", error);
    // Continue with empty platformCounts rather than showing an error
    // since this is not a critical operation
  }

  return (
    <div className="d-flex align-items-center mb-3">
      <small className="text-muted me-2">Filter by platform:</small>
      <ButtonGroup size="sm">
        <Button
          variant={platformFilter === null ? 'primary' : 'outline-primary'}
          onClick={() => setFilter('all')}
        >
          All
          <Badge bg="light" text="dark" className="ms-1">
            {positions.length}
          </Badge>
        </Button>

        {activePlatforms.map(platformId => {
          try {
            const platformMeta = getPlatformMetadata(platformId) || {};
            const platformName = getPlatformName(platformId);
            const platformColor = getPlatformColor(platformId);
            const count = platformCounts[platformId] || 0;

            if (count === 0) return null; // Don't show platforms with no positions

            return (
              <Button
                key={platformId}
                variant={platformFilter === platformId ? 'primary' : 'outline-primary'}
                onClick={() => setFilter(platformId)}
                style={platformFilter === platformId ? {} : {
                  borderColor: platformColor || '#6c757d',
                  color: platformColor || '#6c757d'
                }}
              >
                {platformName || platformId}
                <Badge bg="light" text="dark" className="ms-1">
                  {count}
                </Badge>
              </Button>
            );
          } catch (error) {
            console.error(`Error rendering platform button for ${platformId}:`, error);
            // Return null for this platform button to avoid breaking the entire component
            return null;
          }
        })}
      </ButtonGroup>
    </div>
  );
}
