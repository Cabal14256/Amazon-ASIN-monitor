import AsinIncrementalImportModal from '@/components/AsinIncrementalImportModal';
import services from '@/services/asin';
import React from 'react';
import './ExcelImportModal.less';

interface ExcelImportModalProps {
  visible?: boolean;
  open?: boolean;
  onCancel: () => void;
  onSuccess: () => void;
}

const ExcelImportModal: React.FC<ExcelImportModalProps> = (props) => (
  <AsinIncrementalImportModal
    {...props}
    competitor={false}
    api={{
      preview: services.ASINController.previewImportFromExcel,
      getPreview: services.ASINController.getImportPreview,
      confirm: services.ASINController.confirmImportPreview,
    }}
  />
);

export default ExcelImportModal;
