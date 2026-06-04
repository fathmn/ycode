'use client';

import { studioFetch } from '@/lib/api';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
  FieldDescription,
  FieldLegend,
  FieldSeparator,
} from '@/components/ui/field';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { useAuthStore } from '@/stores/useAuthStore';
import { createClient } from '@/lib/supabase-browser';

export default function ProfilePage() {
  const user = useAuthStore((state) => state.user);
  const checkSession = useAuthStore((state) => state.checkSession);
  const signOut = useAuthStore((state) => state.signOut);

  // Loading states
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [isSavingName, setIsSavingName] = useState(false);
  const [isSavingEmail, setIsSavingEmail] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [isDeletingProfile, setIsDeletingProfile] = useState(false);

  // Dialog states
  const [isNameDialogOpen, setIsNameDialogOpen] = useState(false);
  const [isEmailDialogOpen, setIsEmailDialogOpen] = useState(false);
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  // Form states
  const [nameInput, setNameInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [emailPasswordInput, setEmailPasswordInput] = useState('');
  const [currentPasswordInput, setCurrentPasswordInput] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');

  // Error states
  const [nameError, setNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // Photo upload ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Get user display name and initials
  const displayName = user?.user_metadata?.display_name || user?.user_metadata?.full_name || '';
  const email = user?.email || '';
  const avatarUrl = user?.user_metadata?.avatar_url || null;

  // Get initials for avatar fallback
  const getInitials = (name: string, userEmail: string) => {
    if (name) {
      const parts = name.split(' ');
      if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
      }
      return name.substring(0, 2).toUpperCase();
    }
    if (userEmail) {
      return userEmail.substring(0, 2).toUpperCase();
    }
    return 'U';
  };

  const initials = getInitials(displayName, email);

  // Initialize form values when dialogs open
  useEffect(() => {
    if (isNameDialogOpen) {
      setNameInput(displayName);
      setNameError(null);
    }
  }, [isNameDialogOpen, displayName]);

  useEffect(() => {
    if (isEmailDialogOpen) {
      setEmailInput(email);
      setEmailPasswordInput('');
      setEmailError(null);
    }
  }, [isEmailDialogOpen, email]);

  useEffect(() => {
    if (isPasswordDialogOpen) {
      setCurrentPasswordInput('');
      setNewPasswordInput('');
      setConfirmPasswordInput('');
      setPasswordError(null);
    }
  }, [isPasswordDialogOpen]);

  useEffect(() => {
    if (isDeleteDialogOpen) {
      setDeleteConfirmInput('');
      setDeleteError(null);
    }
  }, [isDeleteDialogOpen]);

  // Handle photo upload
  const handlePhotoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setPhotoError('Bitte wählen Sie eine Bilddatei aus.');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setPhotoError('Das Bild darf maximal 5 MB groß sein.');
      return;
    }

    setIsUploadingPhoto(true);
    setPhotoError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await studioFetch('/ycode/api/profile/avatar', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Profilfoto konnte nicht hochgeladen werden.');
      }

      // Refresh user data to get new avatar
      await checkSession();
    } catch (error) {
      console.error('Failed to upload photo:', error);
      setPhotoError(error instanceof Error ? error.message : 'Profilfoto konnte nicht hochgeladen werden.');
    } finally {
      setIsUploadingPhoto(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Handle name update
  const handleSaveName = async () => {
    if (!nameInput.trim()) {
      setNameError('Name ist erforderlich.');
      return;
    }

    setIsSavingName(true);
    setNameError(null);

    try {
      const response = await studioFetch('/ycode/api/profile/name', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nameInput.trim() }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Name konnte nicht gespeichert werden.');
      }

      // Refresh user data
      await checkSession();
      setIsNameDialogOpen(false);
    } catch (error) {
      console.error('Failed to update name:', error);
      setNameError(error instanceof Error ? error.message : 'Name konnte nicht gespeichert werden.');
    } finally {
      setIsSavingName(false);
    }
  };

  // Handle email update
  const handleSaveEmail = async () => {
    if (!emailInput.trim()) {
      setEmailError('E-Mail-Adresse ist erforderlich.');
      return;
    }

    if (!emailPasswordInput) {
      setEmailError('Zum Ändern der E-Mail-Adresse ist das aktuelle Passwort erforderlich.');
      return;
    }

    setIsSavingEmail(true);
    setEmailError(null);

    try {
      const response = await studioFetch('/ycode/api/profile/email', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: emailInput.trim(),
          password: emailPasswordInput,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'E-Mail-Adresse konnte nicht gespeichert werden.');
      }

      // Refresh user data
      await checkSession();
      setIsEmailDialogOpen(false);
    } catch (error) {
      console.error('Failed to update email:', error);
      setEmailError(error instanceof Error ? error.message : 'E-Mail-Adresse konnte nicht gespeichert werden.');
    } finally {
      setIsSavingEmail(false);
    }
  };

  // Handle password update
  const handleSavePassword = async () => {
    if (!currentPasswordInput) {
      setPasswordError('Aktuelles Passwort ist erforderlich.');
      return;
    }

    if (!newPasswordInput) {
      setPasswordError('Neues Passwort ist erforderlich.');
      return;
    }

    if (newPasswordInput.length < 6) {
      setPasswordError('Das neue Passwort muss mindestens 6 Zeichen lang sein.');
      return;
    }

    if (newPasswordInput !== confirmPasswordInput) {
      setPasswordError('Die Passwörter stimmen nicht überein.');
      return;
    }

    setIsSavingPassword(true);
    setPasswordError(null);

    try {
      const response = await studioFetch('/ycode/api/profile/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: currentPasswordInput,
          newPassword: newPasswordInput,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Passwort konnte nicht gespeichert werden.');
      }

      // Clear inputs and close dialog with success
      setCurrentPasswordInput('');
      setNewPasswordInput('');
      setConfirmPasswordInput('');
      setPasswordError(null);
      setIsPasswordDialogOpen(false);

      // Refresh session to ensure it's still valid after password change
      await checkSession();
    } catch (error) {
      console.error('Failed to update password:', error);
      setPasswordError(error instanceof Error ? error.message : 'Passwort konnte nicht gespeichert werden.');
    } finally {
      setIsSavingPassword(false);
    }
  };

  // Handle profile deletion
  const handleDeleteProfile = async () => {
    if (deleteConfirmInput !== 'DELETE') {
      setDeleteError('Bitte geben Sie DELETE zur Bestätigung ein.');
      return;
    }

    setIsDeletingProfile(true);
    setDeleteError(null);

    try {
      const response = await studioFetch('/ycode/api/profile', {
        method: 'DELETE',
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Profil konnte nicht gelöscht werden.');
      }

      // Sign out and redirect
      const supabase = await createClient();
      await supabase.auth.signOut();
      window.location.href = '/';
    } catch (error) {
      console.error('Failed to delete profile:', error);
      setDeleteError(error instanceof Error ? error.message : 'Profil konnte nicht gelöscht werden.');
    } finally {
      setIsDeletingProfile(false);
    }
  };

  return (
    <div className="p-8">
      <div className="max-w-3xl mx-auto">

        <header className="pt-8 pb-3">
          <span className="text-base font-medium">Mein Profil</span>
        </header>

        {/* Profile Details Section */}
        <div className="grid grid-cols-3 gap-10 bg-secondary/20 p-8 rounded-lg">

          <div>
            <FieldLegend>Profildaten</FieldLegend>
            <FieldDescription>Verwalten Sie Ihre persönlichen Informationen und Kontoeinstellungen.</FieldDescription>
          </div>

          <div className="col-span-2 space-y-0">

            {/* Profile Photo */}
            <div className="flex items-center justify-between py-4">
              <div className="text-sm text-muted-foreground">Profilfoto</div>
              <div className="flex items-center gap-4">
                <div className="relative">
                  {avatarUrl ? (
                    <Image
                      src={avatarUrl}
                      alt="Profilfoto"
                      width={40}
                      height={40}
                      className="size-10 rounded-full object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="size-10 rounded-full bg-orange-100 flex items-center justify-center text-orange-800 font-medium text-sm">
                      {initials}
                    </div>
                  )}
                  {isUploadingPhoto && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full">
                      <Spinner className="size-3 text-white" />
                    </div>
                  )}
                </div>
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoUpload}
                    className="hidden"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploadingPhoto}
                  >
                    Hochladen
                  </Button>
                  {photoError && (
                    <p className="text-xs text-destructive mt-1">{photoError}</p>
                  )}
                </div>
              </div>
            </div>

            <FieldSeparator className="col-span-2" />

            {/* Full Name */}
            <div className="flex items-center justify-between py-4">
              <div className="text-sm text-muted-foreground">Vollständiger Name</div>
              <div className="flex items-center gap-4">
                <span className="text-sm">{displayName || 'Nicht gesetzt'}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setIsNameDialogOpen(true)}
                >
                  Bearbeiten
                </Button>
              </div>
            </div>

            <FieldSeparator className="col-span-2" />

            {/* Email Address */}
            <div className="flex items-center justify-between py-4">
              <div className="text-sm text-muted-foreground">E-Mail-Adresse</div>
              <div className="flex items-center gap-4">
                <span className="text-sm">{email}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setIsEmailDialogOpen(true)}
                >
                  Bearbeiten
                </Button>
              </div>
            </div>

            <FieldSeparator className="col-span-2" />

            {/* Password */}
            <div className="flex items-center justify-between py-4">
              <div className="text-sm text-muted-foreground">Passwort</div>
              <div className="flex items-center gap-4">
                <span className="text-sm">••••••••••••••••••••</span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setIsPasswordDialogOpen(true)}
                >
                  Passwort ändern
                </Button>
              </div>
            </div>

          </div>

        </div>

        {/* Delete Profile Section */}
        <div className="bg-secondary/20 p-8 rounded-lg mt-6">
          <div className="flex items-center justify-center gap-10">
            <div className="flex-1">
              <FieldLegend>Profil löschen</FieldLegend>
              <FieldDescription>Beim Löschen Ihres Profils werden E-Mail-Adresse, Name und weitere Profildaten dauerhaft entfernt. Danach können Sie sich mit diesem Profil nicht mehr einloggen.</FieldDescription>
            </div>
            <Button
              variant="destructive"
              size="sm"
              className="shrink-0"
              onClick={() => setIsDeleteDialogOpen(true)}
            >
              Profil löschen
            </Button>
          </div>
        </div>

      </div>

      {/* Edit Name Dialog */}
      <Dialog open={isNameDialogOpen} onOpenChange={setIsNameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Namen bearbeiten</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Input
              placeholder="Vollständiger Name"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
            />
            {nameError && (
              <p className="text-sm text-destructive">{nameError}</p>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Schließen</Button>
            </DialogClose>
            <Button onClick={handleSaveName} disabled={isSavingName}>
              {isSavingName ? <Spinner className="size-4" /> : 'Änderungen speichern'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Email Dialog */}
      <Dialog open={isEmailDialogOpen} onOpenChange={setIsEmailDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>E-Mail-Adresse ändern</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Input
              type="email"
              placeholder="Neue E-Mail-Adresse"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
            />
            <Input
              type="password"
              placeholder="Aktuelles Passwort"
              value={emailPasswordInput}
              onChange={(e) => setEmailPasswordInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveEmail()}
            />
            {emailError && (
              <p className="text-sm text-destructive">{emailError}</p>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Schließen</Button>
            </DialogClose>
            <Button onClick={handleSaveEmail} disabled={isSavingEmail}>
              {isSavingEmail ? <Spinner className="size-4" /> : 'Änderungen speichern'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Password Dialog */}
      <Dialog open={isPasswordDialogOpen} onOpenChange={setIsPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Passwort ändern</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Input
              type="password"
              placeholder="Aktuelles Passwort"
              value={currentPasswordInput}
              onChange={(e) => setCurrentPasswordInput(e.target.value)}
            />
            <Input
              type="password"
              placeholder="Neues Passwort"
              value={newPasswordInput}
              onChange={(e) => setNewPasswordInput(e.target.value)}
            />
            <Input
              type="password"
              placeholder="Neues Passwort bestätigen"
              value={confirmPasswordInput}
              onChange={(e) => setConfirmPasswordInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSavePassword()}
            />
            {passwordError && (
              <p className="text-sm text-destructive">{passwordError}</p>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Schließen</Button>
            </DialogClose>
            <Button onClick={handleSavePassword} disabled={isSavingPassword}>
              {isSavingPassword ? <Spinner className="size-4" /> : 'Änderungen speichern'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Profile Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Profil löschen</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Diese Aktion kann nicht rückgängig gemacht werden. Alle Profildaten werden dauerhaft gelöscht.
            </p>
            <p className="text-sm">
              Geben Sie <strong>DELETE</strong> zur Bestätigung ein:
            </p>
            <Input
              placeholder="DELETE"
              value={deleteConfirmInput}
              onChange={(e) => setDeleteConfirmInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleDeleteProfile()}
            />
            {deleteError && (
              <p className="text-sm text-destructive">{deleteError}</p>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Schließen</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={handleDeleteProfile}
              disabled={isDeletingProfile || deleteConfirmInput !== 'DELETE'}
            >
              {isDeletingProfile ? <Spinner className="size-4" /> : 'Profil löschen'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
