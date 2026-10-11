import AsinIncrementalImportModal from '@/components/AsinIncrementalImportModal';
import services from '@/services/competitor';
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
    competitor
    api={{
      preview:
        services.CompetitorASINController.previewCompetitorImportFromExcel,
      getPreview: services.CompetitorASINController.getCompetitorImportPreview,
      confirm: services.CompetitorASINController.confirmCompetitorImportPreview,
    }}
  />
);

export default ExcelImportModal;
