import { Routes, Route } from 'react-router-dom';
import { ToastProvider } from './components/Toast';
import Layout from './components/Layout';
import HomePage from './pages/HomePage';
import MedicineDetailPage from './pages/MedicineDetailPage';
import ManagementPage from './pages/ManagementPage';
import PotencyPage from './pages/PotencyPage';
import PackSizePage from './pages/PackSizePage';
import StockPage from './pages/StockPage';

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/medicine/:id" element={<MedicineDetailPage />} />
          <Route path="/stock" element={<StockPage />} />
          <Route path="/manage" element={<ManagementPage />} />
          <Route path="/potencies" element={<PotencyPage />} />
          <Route path="/pack-sizes" element={<PackSizePage />} />
        </Route>
      </Routes>
    </ToastProvider>
  );
}
