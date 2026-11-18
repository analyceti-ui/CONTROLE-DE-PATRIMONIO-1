"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { getClientFirebaseAuth } from "@/lib/firebase-client";

function messageFor(error: unknown) {
  if (error instanceof Error && "code" in error) {
    const code = String(error.code);
    if (["auth/invalid-credential", "auth/user-not-found", "auth/wrong-password"].includes(code)) {
      return "E-mail ou senha incorretos.";
    }
    if (code === "auth/operation-not-allowed") {
      return "Ative o provedor E-mail/senha em Firebase → Authentication → Sign-in method.";
    }
    if (code === "auth/too-many-requests") {
      return "Muitas tentativas. Aguarde um pouco e tente novamente.";
    }
  }
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
      const normalizedEmail = email.trim().toLowerCase();
      const bootstrapResponse = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "bootstrap", email: normalizedEmail, password }),
      });
      if (bootstrapResponse.ok) {
        await signInWithEmailAndPassword(getClientFirebaseAuth(), normalizedEmail, password);
        router.push("/painel");
        return;
      }
      if (bootstrapResponse.status !== 403 && bootstrapResponse.status !== 409) {
        const data = (await bootstrapResponse.json()) as { error?: string };
        throw new Error(data.error ?? "Não foi possível preparar o primeiro acesso.");
      }

      const credential = await signInWithEmailAndPassword(getClientFirebaseAuth(), normalizedEmail, password);
      const idToken = await credential.user.getIdToken();
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", idToken }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "Não foi possível carregar seu perfil.");
      }
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
