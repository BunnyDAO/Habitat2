import React, { useState } from 'react';
import styles from '../styles/SidebarMenu.module.css';

export type Section = 'trading-wallets' | 'available-lackeys' | 'active-lackeys';

interface SidebarMenuProps {
  currentSection: Section;
  onSectionChange: (section: Section) => void;
  isOpen: boolean;
  onClose: () => void;
}

export const SidebarMenu: React.FC<SidebarMenuProps> = ({
  currentSection,
  onSectionChange,
  isOpen,
  onClose,
}) => {
  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div 
          className={styles.overlay}
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <div className={`${styles.sidebar} ${isOpen ? styles.open : ''}`}>
        <div className={styles.sidebarHeader}>
          <h2>Sections</h2>
          <button 
            className={styles.closeButton}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className={styles.sidebarContent}>
          <button
            className={`${styles.sectionButton} ${currentSection === 'trading-wallets' ? styles.active : ''}`}
            onClick={() => {
              onSectionChange('trading-wallets');
              onClose();
            }}
          >
            <span className={styles.icon}>💼</span>
            Trading Wallets
          </button>

          <button
            className={`${styles.sectionButton} ${currentSection === 'available-lackeys' ? styles.active : ''}`}
            onClick={() => {
              onSectionChange('available-lackeys');
              onClose();
            }}
          >
            <span className={styles.icon}>👥</span>
            Available Lackeys
          </button>

          <button
            className={`${styles.sectionButton} ${currentSection === 'active-lackeys' ? styles.active : ''}`}
            onClick={() => {
              onSectionChange('active-lackeys');
              onClose();
            }}
          >
            <span className={styles.icon}>⚡</span>
            Active Lackeys
          </button>
        </div>
      </div>
    </>
  );
};

export const HamburgerButton: React.FC<{ onClick: () => void }> = ({ onClick }) => {
  return (
    <button className={styles.hamburgerButton} onClick={onClick}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="3" y1="18" x2="21" y2="18" />
      </svg>
    </button>
  );
}; 