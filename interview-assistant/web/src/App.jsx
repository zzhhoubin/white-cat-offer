import { Navigate, Routes, Route, useLocation } from "react-router-dom";
import Nav from "./components/Nav.jsx";
import AuthModal from "./components/AuthModal.jsx";
import Home from "./pages/Home.jsx";
import Resume from "./pages/Resume.jsx";
import QuestionBank from "./pages/QuestionBank.jsx";
import Projects from "./pages/Projects.jsx";
import MianJing from "./pages/MianJing.jsx";
import Review from "./pages/Review.jsx";
import Account from "./pages/Account.jsx";
import UserCenter from "./pages/UserCenter.jsx";
import AiProviders from "./pages/AiProviders.jsx";
import Interview from "./pages/Interview.jsx";

export default function App() {
  const { pathname } = useLocation();
  const isHome = pathname === "/";
  const isQuestions = pathname.startsWith("/questions");
  const routes = (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/resume" element={<Resume />} />
      <Route path="/questions" element={<QuestionBank />} />
      <Route path="/questions/records" element={<Navigate to="/questions" replace />} />
      <Route path="/questions/studio" element={<Navigate to="/questions" replace />} />
      <Route path="/projects" element={<Projects />} />
      <Route path="/mianjing" element={<MianJing />} />
      <Route path="/review" element={<Review />} />
      <Route path="/account" element={<Account />} />
      <Route path="/user" element={<UserCenter />} />
      <Route path="/user/info" element={<UserCenter />} />
      <Route path="/user/credit" element={<UserCenter />} />
      <Route path="/user/order" element={<UserCenter />} />
      <Route path="/user/notifications" element={<UserCenter />} />
      <Route path="/user/feedback" element={<UserCenter />} />
      <Route path="/user/referral" element={<UserCenter />} />
      <Route path="/ai-providers" element={<AiProviders />} />
      <Route path="/interview/:mode" element={<Interview />} />
    </Routes>
  );

  return (
    <div className="app">
      <Nav />
      <AuthModal />
      {isHome || isQuestions ? routes : <div className="page-shell">{routes}</div>}
    </div>
  );
}
