import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
    signInWithEmailAndPassword,
    GoogleAuthProvider,
    signInWithPopup,
    fetchSignInMethodsForEmail
} from 'firebase/auth';
import { auth } from '../lib/firebase';
import { Shield, Mail, Key, Globe, Loader2 } from 'lucide-react';

export const LoginPage: React.FC = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [step, setStep] = useState<'email' | 'password' | 'mfa'>('email');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const navigate = useNavigate();
    const location = useLocation();
    const from = location.state?.from?.pathname || '/';

    const handleEmailSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            // Check if user exists and what methods they have
            // Note: fetchSignInMethodsForEmail requires 'Email Enumeration Protection' to be disabled 
            // in Firebase Console for this to work as a "check if user exists" mechanism.
            // If enabled, it always returns an empty list.
            const methods = await fetchSignInMethodsForEmail(auth, email);

            if (methods.length === 0) {
                // In a production app, you might want to handle registration here
                // For now, we'll assume they need to use a password or social
                setStep('password');
            } else {
                // If they have methods, we could check for passkeys here
                // For now, we'll default to password
                setStep('password');
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handlePasswordSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            await signInWithEmailAndPassword(auth, email, password);
            navigate(from, { replace: true });
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleSignIn = async () => {
        setLoading(true);
        setError(null);
        const provider = new GoogleAuthProvider();
        try {
            await signInWithPopup(auth, provider);
            navigate(from, { replace: true });
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    // Placeholder for Passkey flow
    const handlePasskeySignIn = async () => {
        setError("Passkey support requires Identity Platform and specific domain configuration. Please use Google or Password for now.");
    };

    return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
            <div className="max-w-md w-full space-y-8 bg-surface p-8 rounded-2xl border border-border shadow-xl">
                <div className="text-center">
                    <div className="flex justify-center">
                        <div className="p-3 bg-primary/10 rounded-xl">
                            <Shield className="h-10 w-10 text-primary" />
                        </div>
                    </div>
                    <h2 className="mt-6 text-3xl font-bold tracking-tight text-text">
                        respondA
                    </h2>
                    <p className="mt-2 text-sm text-text-muted">
                        Secure Access to Incident Management
                    </p>
                </div>

                {error && (
                    <div className="p-4 bg-error/10 border border-error/20 rounded-lg text-error text-sm break-words overflow-hidden w-full">
                        {error}
                    </div>
                )}

                {step === 'email' && (
                    <form className="mt-8 space-y-6" onSubmit={handleEmailSubmit}>
                        <div className="space-y-4">
                            <div>
                                <label htmlFor="email-address" className="sr-only">Email address</label>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <Mail className="h-5 w-5 text-text-muted" />
                                    </div>
                                    <input
                                        id="email-address"
                                        name="email"
                                        type="email"
                                        required
                                        className="appearance-none relative block w-full px-10 py-3 border border-border bg-background placeholder-text-muted text-text rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent sm:text-sm"
                                        placeholder="Email address"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <button
                                type="submit"
                                disabled={loading}
                                className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-semibold rounded-xl text-white bg-primary hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 transition-colors"
                            >
                                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Continue'}
                            </button>

                            <div className="relative py-4">
                                <div className="absolute inset-0 flex items-center">
                                    <div className="w-full border-t border-border"></div>
                                </div>
                                <div className="relative flex justify-center text-xs uppercase">
                                    <span className="bg-surface px-2 text-text-muted font-medium">Or continue with</span>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    type="button"
                                    onClick={handleGoogleSignIn}
                                    className="w-full inline-flex justify-center py-2.5 px-4 border border-border rounded-xl bg-background text-sm font-medium text-text hover:bg-surface-hover transition-colors items-center gap-2"
                                >
                                    <Globe className="h-4 w-4" />
                                    Google
                                </button>
                                <button
                                    type="button"
                                    onClick={handlePasskeySignIn}
                                    className="w-full inline-flex justify-center py-2.5 px-4 border border-border rounded-xl bg-background text-sm font-medium text-text hover:bg-surface-hover transition-colors items-center gap-2"
                                >
                                    <Key className="h-4 w-4" />
                                    Passkey
                                </button>
                            </div>
                        </div>
                    </form>
                )}

                {step === 'password' && (
                    <form className="mt-8 space-y-6" onSubmit={handlePasswordSubmit}>
                        <div className="space-y-4">
                            <div className="flex items-center gap-2 text-sm text-text-muted px-1">
                                <Mail className="h-4 w-4" />
                                {email}
                                <button
                                    type="button"
                                    onClick={() => setStep('email')}
                                    className="ml-auto text-primary hover:underline font-medium"
                                >
                                    Change
                                </button>
                            </div>
                            <div>
                                <label htmlFor="password" className="sr-only">Password</label>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <Key className="h-5 w-5 text-text-muted" />
                                    </div>
                                    <input
                                        id="password"
                                        name="password"
                                        type="password"
                                        required
                                        className="appearance-none relative block w-full px-10 py-3 border border-border bg-background placeholder-text-muted text-text rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent sm:text-sm"
                                        placeholder="Password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>

                        <div>
                            <button
                                type="submit"
                                disabled={loading}
                                className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-semibold rounded-xl text-white bg-primary hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 transition-colors"
                            >
                                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Sign in'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
};
