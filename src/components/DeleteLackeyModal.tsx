import React from 'react';

interface DeleteLackeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  lackeyType: string;
  lackeyDetails: string;
}

const DeleteLackeyModal: React.FC<DeleteLackeyModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  lackeyType,
  lackeyDetails
}) => {
  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div style={{
        backgroundColor: '#1e293b',
        padding: '1.5rem',
        borderRadius: '0.5rem',
        width: '90%',
        maxWidth: '500px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
      }}>
        <h2 style={{ 
          color: '#e2e8f0', 
          marginTop: 0, 
          fontSize: '1.25rem',
          marginBottom: '1rem'
        }}>
          Delete Lackey
        </h2>

        <p style={{ color: '#94a3b8', marginBottom: '1rem', fontSize: '0.875rem' }}>
          Are you sure you want to delete this {lackeyType}?
        </p>

        <p style={{ color: '#e2e8f0', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
          {lackeyDetails}
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button
            onClick={onClose}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#4b5563',
              color: 'white',
              border: 'none',
              borderRadius: '0.25rem',
              cursor: 'pointer',
              fontSize: '0.875rem'
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#ef4444',
              color: 'white',
              border: 'none',
              borderRadius: '0.25rem',
              cursor: 'pointer',
              fontSize: '0.875rem'
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeleteLackeyModal; 