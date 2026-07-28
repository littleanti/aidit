import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './layout/AppLayout';
import Home from './pages/Home';
import Login from './pages/Login';
import Community from './pages/Community';
import CreateCommunity from './pages/CreateCommunity';
import CreatePost from './pages/CreatePost';
import Thread from './pages/Thread';
import DocumentPage from './pages/Document';
import Search from './pages/Search';
import Profile from './pages/Profile';
import Settings from './pages/Settings';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* login sits outside the main shell */}
        <Route path="/login" element={<Login />} />

        <Route element={<AppLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<Search />} />
          <Route path="/me" element={<Profile />} />
          <Route path="/me/settings" element={<Settings />} />
          <Route path="/c/:slug" element={<Community />} />
          <Route path="/c/:slug/create-post" element={<CreatePost />} />
          <Route path="/create-post" element={<CreatePost />} />
          <Route path="/create-community" element={<CreateCommunity />} />
          <Route path="/p/:postId" element={<Thread />} />
          {/* FR-13.6: condensed discussion document */}
          <Route path="/d/:documentId" element={<DocumentPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
