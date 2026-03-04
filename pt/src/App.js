import { Routes, Route, useParams, Navigate } from 'react-router-dom';
import { LangProvider } from './LangContext';
import Home from './pages/Home';
import StoryEngine from './pages/StoryEngine';
import STORIES from './stories';

function StoryRoute() {
  const { id } = useParams();
  const story = STORIES.find(s => s.id === id);
  if (!story) return <Navigate to="/" replace />;
  return <StoryEngine story={story} />;
}

export default function App() {
  return (
    <LangProvider>
      <Routes>
        <Route path="/"          element={<Home />} />
        <Route path="/story/:id" element={<StoryRoute />} />
        <Route path="*"          element={<Navigate to="/" replace />} />
      </Routes>
    </LangProvider>
  );
}
