"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

function messageFor(error: unknown) {
  return error instanceof Error ? error.message : "Não foi possível entrar. Tente novamente.";
}

export default function HomePage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", email: email.trim(), password }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "Não foi possível carregar seu perfil.");
      }
      window.sessionStorage.removeItem("patrimonio-dashboard-cache-v1");
      router.push("/painel");
    } catch (submitError) {
      setError(messageFor(submitError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-intro">
        <div className="brand brand-light"><span className="brand-mark">P</span> patrimônio</div>
        <div className="intro-content">
          <span className="eyebrow">CONTROLE SIMPLES. GESTÃO INTELIGENTE.</span>
          <h1>Seus ativos,<br />sempre em boas mãos.</h1>
          <p>Organize veículos, computadores e equipamentos em um só lugar.</p>
          <div className="intro-stats">
            <div><strong>01</strong><span>Um lugar para tudo</span></div>
            <div><strong>02</strong><span>Alertas no momento certo</span></div>
            <div><strong>03</strong><span>Histórico sempre à mão</span></div>
          </div>
        </div>
        <span className="intro-foot">GESTÃO DE PATRIMÔNIO</span>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <div className="mobile-brand brand"><span className="brand-mark">P</span> patrimônio</div>
          <span className="eyebrow">BEM-VINDO DE VOLTA</span>
          <h2>Acesse sua conta</h2>
          <p className="muted">Entre para acompanhar seus ativos.</p>
          <form onSubmit={submit} className="auth-form">
            <label>
              E-mail
              <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required placeholder="voce@empresa.com.br" />
            </label>
            <label>
              Senha
              <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required placeholder="Sua senha" />
            </label>
            {error && <p className="error-message" role="alert">{error}</p>}
            <button className="button button-primary full-width" type="submit" disabled={busy}>
              {busy ? "Aguarde..." : "Entrar na plataforma"}
              {!busy && <span aria-hidden="true">→</span>}
            </button>
          </form>
          <p className="auth-security">Acesso criado pelo administrador do sistema.</p>
        </div>
      </section>
    </main>
  );
}
