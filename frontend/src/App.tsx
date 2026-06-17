import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './layout/AppLayout';
import Home from './pages/Home';
import Login from './pages/Login';
import Community from './pages/Community';
import CreateCommunity from './pages/CreateCommunity';
import CreatePost from './pages/CreatePost';
import Thread from './pages/Thread';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* login sits outside the main shell */}
        <Route path="/login" element={<Login />} />

        <Route element={<AppLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/c/:slug" element={<Community />} />
          <Route path="/c/:slug/create-post" element={<CreatePost />} />
          <Route path="/create-post" element={<CreatePost />} />
          <Route path="/create-community" element={<CreateCommunity />} />
          <Route path="/p/:postId" element={<Thread />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
