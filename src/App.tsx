import { useState } from 'react';
import { FiscalYearProvider } from './contexts/FiscalYearContext';
import { LayoutShell } from './components/LayoutShell';
import { SupabaseConfigModal } from './components/SupabaseConfigModal';
import { DashboardView } from './components/DashboardView';
import { VoucherWorkbenchView } from './components/VoucherWorkbenchView';
import { ExcelImporterView } from './components/ExcelImporterView';
import { AgentQueueView } from './components/AgentQueueView';
import { YearEndClosingView } from './components/YearEndClosingView';
import { StatementsAndMcpView } from './components/StatementsAndMcpView';
import { MasterDataView } from './components/MasterDataView';
import type { ActiveViewId } from './types/erp';

export default function App() {
  const [activeView, setActiveView] = useState<ActiveViewId>('dashboard');

  return (
    <FiscalYearProvider>
      <LayoutShell activeView={activeView} onSelectView={setActiveView}>
        {activeView === 'dashboard' && <DashboardView onNavigate={setActiveView} />}
        {activeView === 'vouchers' && <VoucherWorkbenchView />}
        {activeView === 'excel_import' && <ExcelImporterView />}
        {activeView === 'agent_queue' && <AgentQueueView />}
        {activeView === 'year_end' && <YearEndClosingView onNavigate={setActiveView} />}
        {activeView === 'statements' && <StatementsAndMcpView />}
        {activeView === 'master_data' && <MasterDataView />}
      </LayoutShell>
      <SupabaseConfigModal />
    </FiscalYearProvider>
  );
}
