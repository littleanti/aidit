import { useNavigate } from 'react-router-dom';
import Logo from '../components/Logo';
import LoginForm from '../components/LoginForm';
import { useT } from '../i18n/useT';
import ShellPrompt from '../components/ShellPrompt';

export default function Login() {
  const navigate = useNavigate();
  const { t } = useT();

  return (
    <div className="mx-auto max-w-sm py-8 font-mono">
      <ShellPrompt command="login" className="mb-3" />
      <div className="rounded-[3px] border border-term-cta bg-[#06160c] p-6 shadow-[0_0_32px_rgba(43,212,111,0.28)]">
        <div className="mb-1">
          <Logo size="lg" />
        </div>
        <p className="mb-6 text-sm text-term-dim">
          {t('auth.tagline')}
        </p>

        <LoginForm onSuccess={() => navigate('/')} />
      </div>
    </div>
  );
}
