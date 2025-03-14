// src/components/PlatformFilter.js
import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { ButtonGroup, Button, Badge } from 'react-bootstrap';
import { setPlatformFilter } from '../redux/platformsSlice';
import config from '../utils/config';

export default function PlatformFilter() {
  const dispatch = useDispatch();
  const { activePlatforms, platformFilter } = useSelector(state => state.platforms);
  const positions = useSelector(state => state.positions.positions || []);

  // If there are no active platforms or no positions, don't render the filter
  if (!activePlatforms || activePlatforms.length <= 1 || !positions.length) {
    return null;
  }

  // Set the filter to a specific platform or null (show all)
  const setFilter = (platformId) => {
    dispatch(setPlatformFilter(platformId === 'all' ? null : platformId));
  };

  // Count positions by platform
  const platformCounts = {};
  positions.forEach(position => {
    if (position.platform) {
      platformCounts[position.platform] = (platformCounts[position.platform] || 0) + 1;
    }
  });

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
          const platformMeta = config.platformMetadata[platformId] || {};
          const count = platformCounts[platformId] || 0;

          if (count === 0) return null; // Don't show platforms with no positions

          return (
            <Button
              key={platformId}
              variant={platformFilter === platformId ? 'primary' : 'outline-primary'}
              onClick={() => setFilter(platformId)}
              style={platformFilter === platformId ? {} : {
                borderColor: platformMeta.color || '#6c757d',
                color: platformMeta.color || '#6c757d'
              }}
            >
              {platformMeta.name || platformId}
              <Badge bg="light" text="dark" className="ms-1">
                {count}
              </Badge>
            </Button>
          );
        })}
      </ButtonGroup>
    </div>
  );
}
