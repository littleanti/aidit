import { useNavigate } from 'react-router-dom';
import Logo from '../components/Logo';
import LoginForm from '../components/LoginForm';

export default function Login() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-sm py-8 font-mono">
      <div className="rounded-[3px] border border-term-cta bg-[#06160c] p-6 shadow-[0_0_32px_rgba(43,212,111,0.28)]">
        <div className="mb-1">
          <Logo size="lg" />
        </div>
        <p className="mb-6 text-sm text-term-dim">
          커뮤니티에서 함께 만드는 AI 대화
        </p>

        <LoginForm onSuccess={() => navigate('/')} />
      </div>
    </div>
  );
}
