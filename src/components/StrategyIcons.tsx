import React from 'react';

interface IconProps {
  isActive?: boolean;
  onClick?: () => void;
}

export const TradingWalletIcon: React.FC<IconProps> = ({ isActive = true, onClick }) => (
  <span
    onClick={(e) => {
      if (onClick) {
        e.stopPropagation();
        onClick();
      }
    }}
    style={{
      cursor: onClick ? 'pointer' : 'default',
      opacity: isActive ? 1 : 0.5,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'white',
      marginTop: '2px'
    }}
  >
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 11v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V11" />
      <path d="M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
      <path d="M12 12v.01" />
      <rect x="3" y="11" width="18" height="4" rx="1" />
    </svg>
  </span>
);

export const LackeyIcon: React.FC<IconProps> = ({ isActive = true, onClick }) => (
  <span
    onClick={(e) => {
      if (onClick) {
        e.stopPropagation();
        onClick();
      }
    }}
    style={{
      cursor: onClick ? 'pointer' : 'default',
      opacity: isActive ? 1 : 0.5,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'white',
      marginTop: '2px'
    }}
  >
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  </span>
);

export const PriceMonitorIcon: React.FC<IconProps> = ({ isActive = true, onClick }) => (
  <span
    onClick={(e) => {
      if (onClick) {
        e.stopPropagation();
        onClick();
      }
    }}
    style={{
      cursor: onClick ? 'pointer' : 'default',
      opacity: isActive ? 1 : 0.5,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'white',
      marginTop: '2px'
    }}
  >
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 3v18h18" />
      <path d="m19 9-5 5-4-4-3 3" />
    </svg>
  </span>
);

export const VaultIcon: React.FC<IconProps> = ({ isActive = true, onClick }) => (
  <span
    onClick={(e) => {
      if (onClick) {
        e.stopPropagation();
        onClick();
      }
    }}
    style={{
      cursor: onClick ? 'pointer' : 'default',
      opacity: isActive ? 1 : 0.5,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'white',
      marginTop: '2px'
    }}
  >
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  </span>
);

export const LevelsIcon: React.FC<IconProps> = ({ isActive = true, onClick }) => (
  <span
    onClick={(e) => {
      if (onClick) {
        e.stopPropagation();
        onClick();
      }
    }}
    style={{
      cursor: onClick ? 'pointer' : 'default',
      opacity: isActive ? 1 : 0.5,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'white',
      marginTop: '2px'
    }}
  >
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  </span>
);

export const PairTradeIcon: React.FC<IconProps> = ({ isActive = true, onClick }) => (
  <span
    onClick={(e) => {
      if (onClick) {
        e.stopPropagation();
        onClick();
      }
    }}
    style={{
      cursor: onClick ? 'pointer' : 'default',
      opacity: isActive ? 1 : 0.5,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'white',
      marginTop: '2px'
    }}
  >
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 17L17 7" />
      <path d="M17 17H7V7" />
      <circle cx="7" cy="7" r="2" />
      <circle cx="17" cy="17" r="2" />
    </svg>
  </span>
);

export const DriftPerpIcon: React.FC<IconProps> = ({ isActive = true, onClick }) => (
  <span
    onClick={(e) => {
      if (onClick) {
        e.stopPropagation();
        onClick();
      }
    }}
    style={{
      cursor: onClick ? 'pointer' : 'default',
      opacity: isActive ? 1 : 0.5,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'white',
      marginTop: '2px'
    }}
  >
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Drift perpetual futures icon - trending line with leverage indicators */}
      <path d="M3 12L7 8L11 14L17 6L21 10" />
      <path d="M21 6H17V10" />
      {/* Leverage indicator */}
      <rect x="2" y="18" width="4" height="4" rx="1" />
      <rect x="10" y="18" width="4" height="4" rx="1" />
      <rect x="18" y="18" width="4" height="4" rx="1" />
      <text x="4" y="21" fontSize="6" textAnchor="middle" fill="currentColor">x</text>
      <text x="12" y="21" fontSize="6" textAnchor="middle" fill="currentColor">∞</text>
      <text x="20" y="21" fontSize="6" textAnchor="middle" fill="currentColor">↕</text>
    </svg>
  </span>
); 