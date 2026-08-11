import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { LogOut, UserRound } from 'lucide-react';
import { salaryBookApi } from '../../lib/api';
import { auth, type User } from '../../lib/auth';
import { displayName, initials, isStandaloneApp } from '../../lib/salaryBookPwa';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import { toast } from '../../lib/toast';
import { apiError } from './utils';
import AddToHomeHint from './components/AddToHomeHint';

export default function ProfilePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['salary-book', 'me'],
    queryFn: async () => (await salaryBookApi.me()).data as User,
  });

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    if (!data) return;
    setFirstName(data.first_name || '');
    setLastName(data.last_name || '');
    setEmail(data.email || '');
    setPhone(data.phone || '');
  }, [data]);

  const saveProfile = useMutation({
    mutationFn: () =>
      salaryBookApi.updateMe({
        first_name: firstName,
        last_name: lastName,
        email,
        phone,
      }),
    onSuccess: async (res) => {
      auth.setUser(res.data, 'salary_book');
      await queryClient.invalidateQueries({ queryKey: ['salary-book', 'me'] });
      toast('Profile saved', 'success');
    },
    onError: (err) => toast(apiError(err, 'Unable to save profile.'), 'error'),
  });

  const changePassword = useMutation({
    mutationFn: () => {
      if (newPassword !== confirmPassword) {
        throw new Error('PASSWORDS_MISMATCH');
      }
      return salaryBookApi.changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      });
    },
    onSuccess: (res) => {
      const { access, refresh } = res.data;
      localStorage.setItem('salary_book_access_token', access);
      if (refresh) localStorage.setItem('salary_book_refresh_token', refresh);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast('Password updated. You are still signed in on this phone.', 'success');
    },
    onError: (err) => {
      if ((err as Error).message === 'PASSWORDS_MISMATCH') {
        toast('New passwords do not match.', 'error');
        return;
      }
      toast(apiError(err, 'Unable to change password.'), 'error');
    },
  });

  if (isLoading) return <LoadingState message="Loading profile..." />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;

  return (
    <div className="space-y-5 lg:max-w-xl">
      <div className="bg-white rounded-2xl border border-emerald-100 p-6 text-center">
        <div className="mx-auto h-20 w-20 rounded-full bg-emerald-700 text-white flex items-center justify-center text-2xl font-semibold">
          {initials(data)}
        </div>
        <h1 className="mt-3 text-xl font-bold text-gray-900">{displayName(data)}</h1>
        <p className="text-sm text-gray-500">@{data.username}</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {(data.groups || []).map((g) => (
            <span key={g} className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 text-xs font-medium">
              {g}
            </span>
          ))}
          {data.is_superuser && (
            <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 text-xs font-medium">Admin</span>
          )}
        </div>
      </div>

      {!isStandaloneApp() && <AddToHomeHint />}

      <form
        className="bg-white rounded-2xl border border-emerald-100 p-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          saveProfile.mutate();
        }}
      >
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          <UserRound className="h-4 w-4" /> Your details
        </h2>
        <Input label="User ID" value={data.username} disabled />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          <Input label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
        <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input label="Phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <Button type="submit" className="w-full min-h-12 bg-emerald-600 hover:bg-emerald-700" loading={saveProfile.isPending}>
          Save profile
        </Button>
      </form>

      <form
        className="bg-white rounded-2xl border border-emerald-100 p-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          changePassword.mutate();
        }}
      >
        <h2 className="font-semibold text-gray-900">Change password</h2>
        <p className="text-xs text-gray-500">
          Other devices will be signed out. This phone stays signed in.
        </p>
        <Input
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <Input
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
        <Button
          type="submit"
          variant="outline"
          className="w-full min-h-12"
          loading={changePassword.isPending}
        >
          Update password
        </Button>
      </form>

      <button
        type="button"
        onClick={() => {
          auth.logout('salary_book');
          navigate('/salary-book/login');
        }}
        className="w-full min-h-12 rounded-xl border border-red-200 text-red-700 font-medium inline-flex items-center justify-center gap-2 bg-white"
      >
        <LogOut className="h-4 w-4" />
        Logout
      </button>
    </div>
  );
}
