import React from 'react';

interface DeleteLackeyDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  lackeyName?: string;
}

const DeleteLackeyDialog: React.FC<DeleteLackeyDialogProps> = ({ 
  isOpen, 
  onClose,
  onConfirm,
  lackeyName
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
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 1000
    }}>
      <div style={{
        backgroundColor: '#1e293b',
        padding: '2rem',
        borderRadius: '0.75rem',
        maxWidth: '520px',
        width: '90%',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        border: '1px solid #2d3748'
      }}>
        <h3 style={{
          color: '#e2e8f0',
          margin: '0 0 1rem 0',
          fontSize: '1.25rem',
          fontWeight: '600'
        }}>
          Delete Strategy
        </h3>
        <div style={{
          color: '#94a3b8',
          margin: '0 0 1.5rem 0',
          fontSize: '1rem',
          lineHeight: '1.5'
        }}>
          <p style={{ margin: '0 0 0.75rem 0' }}>
            Are you sure you want to delete {lackeyName ? <span style={{ color: '#e2e8f0', fontWeight: '500' }}>{lackeyName}</span> : 'this strategy'}?
          </p>
          <p style={{ margin: 0, fontSize: '0.875rem', color: '#64748b' }}>
            This action cannot be undone.
          </p>
        </div>
        <div style={{
          display: 'flex',
          gap: '0.75rem',
          justifyContent: 'flex-end'
        }}>
          <button
            onClick={onClose}
            style={{
              backgroundColor: '#1e293b',
              color: '#94a3b8',
              border: '1px solid #4b5563',
              borderRadius: '0.375rem',
              padding: '0.5rem 1.25rem',
              fontSize: '0.875rem',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.backgroundColor = '#2d3748';
              e.currentTarget.style.borderColor = '#6b7280';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = '#1e293b';
              e.currentTarget.style.borderColor = '#4b5563';
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              backgroundColor: '#dc2626',
              color: 'white',
              border: 'none',
              borderRadius: '0.375rem',
              padding: '0.5rem 1.25rem',
              fontSize: '0.875rem',
              cursor: 'pointer',
              transition: 'background-color 0.2s ease',
              fontWeight: '500'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.backgroundColor = '#b91c1c';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = '#dc2626';
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeleteLackeyDialog; 