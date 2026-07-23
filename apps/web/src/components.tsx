import React, { useEffect, useRef, useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import { Button, Card, Chip, IconButton, Menu, Text, useTheme } from 'react-native-paper';
import { absoluteAudioUrl } from './api';
import type { Category, Entry, VoiceOption } from './types';

export function CategoryPicker({ categories, value, onChange, label = 'Kategorie (optional)' }: {
  categories: Category[]; value: string | null; onChange: (id: string | null) => void; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = categories.find((item) => item.id === value);
  return (
    <Menu visible={open} onDismiss={() => setOpen(false)} anchor={
      <Button mode="outlined" icon="folder-outline" onPress={() => setOpen(true)} contentStyle={styles.control} accessibilityLabel={label}>
        {selected?.name ?? label}
      </Button>
    }>
      <Menu.Item title="Ohne Kategorie" leadingIcon="folder-off-outline" onPress={() => { onChange(null); setOpen(false); }} />
      {categories.map((category) => <Menu.Item key={category.id} title={category.name} leadingIcon="folder-outline" onPress={() => { onChange(category.id); setOpen(false); }} />)}
    </Menu>
  );
}

export function VoicePicker({ voices, value, onChange }: { voices: VoiceOption[]; value: string; onChange: (voice: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = voices.find((voice) => voice.id === value);
  return <Menu visible={open} onDismiss={() => setOpen(false)} anchor={
    <Button mode="outlined" icon="account-voice" onPress={() => setOpen(true)} contentStyle={styles.control} disabled={!voices.length}>
      {selected ? `Stimme: ${selected.name}` : 'Stimmen werden geladen …'}
    </Button>
  }>
    {voices.map((voice) => <Menu.Item key={voice.id} title={`${voice.name} (${voice.gender === 'female' ? 'weiblich' : 'männlich'})`} leadingIcon="account-voice" onPress={() => { onChange(voice.id); setOpen(false); }} />)}
  </Menu>;
}

export function AudioPlayer({ url }: { url: string }) {
  const theme = useTheme();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);

  useEffect(() => {
    setPlaying(false); setCurrentTime(0); setDuration(0); setRate(1);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.playbackRate = 1;
    }
  }, [url]);

  if (Platform.OS === 'web') {
    const AudioElement = 'audio' as unknown as React.ElementType;
    const RangeInput = 'input' as unknown as React.ElementType;
    const togglePlayback = () => {
      const audio = audioRef.current;
      if (!audio) return;
      if (audio.paused) void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
      else { audio.pause(); setPlaying(false); }
    };
    const toggleRate = () => {
      const next = rate === 1 ? 0.75 : 1;
      setRate(next);
      if (audioRef.current) audioRef.current.playbackRate = next;
    };
    return <View style={[styles.audioPlayer, { backgroundColor: theme.colors.secondaryContainer }]}>
      <AudioElement
        ref={audioRef} preload="metadata" src={absoluteAudioUrl(url)} style={{ display: 'none' }}
        onLoadedMetadata={(event: React.SyntheticEvent<HTMLAudioElement>) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        onTimeUpdate={(event: React.SyntheticEvent<HTMLAudioElement>) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setCurrentTime(0); }}
      />
      <IconButton icon={playing ? 'pause' : 'play'} mode="contained" size={25} onPress={togglePlayback} accessibilityLabel={playing ? 'Audio pausieren' : 'Italienische Aussprache abspielen'} />
      <View style={styles.audioProgress}>
        <RangeInput
          type="range" min={0} max={duration || 0} step={0.1} value={Math.min(currentTime, duration || 0)} disabled={!duration}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => { const next = Number(event.target.value); if (audioRef.current) audioRef.current.currentTime = next; setCurrentTime(next); }}
          aria-label="Wiedergabeposition" style={{ width: '100%', accentColor: theme.colors.primary }}
        />
        <Text variant="labelSmall" style={{ color: theme.colors.onSecondaryContainer }}>{formatTime(currentTime)} / {formatTime(duration)}</Text>
      </View>
      <Button compact mode={rate < 1 ? 'contained' : 'text'} icon="speedometer-slow" onPress={toggleRate} accessibilityLabel="Wiedergabegeschwindigkeit umschalten">
        {rate < 1 ? '1× Normal' : '0,75× Langsam'}
      </Button>
    </View>;
  }
  return <Text variant="bodyMedium">Audiowiedergabe ist in dieser MVP-Version für das Web optimiert.</Text>;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}

async function confirmDelete(message: string): Promise<boolean> {
  if (Platform.OS === 'web') return globalThis.confirm(message);
  return new Promise((resolve) => Alert.alert('Wirklich löschen?', message, [
    { text: 'Abbrechen', style: 'cancel', onPress: () => resolve(false) },
    { text: 'Löschen', style: 'destructive', onPress: () => resolve(true) },
  ]));
}

export function EntryCard({ entry, categories, busy, hideAudio = false, onRetryAudio, onDelete, onAssign }: {
  entry: Entry; categories: Category[]; busy?: boolean;
  hideAudio?: boolean;
  onRetryAudio: (entry: Entry) => void; onDelete: (entry: Entry) => void; onAssign: (entry: Entry, categoryId: string | null) => void;
}) {
  const theme = useTheme();
  const [categoryOpen, setCategoryOpen] = useState(false);
  const date = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.createdAt));
  return (
    <Card mode="elevated" style={styles.card} accessible accessibilityLabel={`Deutsch: ${entry.sourceText}. Italienisch: ${entry.translatedText}`}>
      <Card.Content style={styles.cardContent}>
        <View style={styles.metaRow}>
          <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>{date}</Text>
          {entry.categoryName ? <Chip compact icon="folder-outline">{entry.categoryName}</Chip> : null}
        </View>
        <View style={styles.languageBlock}>
          <Text variant="labelLarge" style={{ color: theme.colors.primary }}>DEUTSCH</Text>
          <Text variant="titleMedium" selectable>{entry.sourceText}</Text>
        </View>
        <View style={[styles.languageBlock, { backgroundColor: theme.colors.primaryContainer }]}>
          <Text variant="labelLarge" style={{ color: theme.colors.onPrimaryContainer }}>ITALIENISCH</Text>
          <Text variant="headlineSmall" selectable style={{ color: theme.colors.onPrimaryContainer }}>{entry.translatedText}</Text>
        </View>
        {!hideAudio && (entry.audioStatus === 'ready' && entry.audioUrl ? <AudioPlayer url={entry.audioUrl} /> : (
          <View style={[styles.audioError, { backgroundColor: theme.colors.errorContainer }]}>
            <Text style={{ color: theme.colors.onErrorContainer }}>Audio konnte nicht erstellt werden.</Text>
            <Button mode="text" icon="refresh" loading={Boolean(busy)} disabled={Boolean(busy)} onPress={() => onRetryAudio(entry)}>Audio erneut versuchen</Button>
          </View>
        ))}
        <View style={styles.cardActions}>
          <Menu visible={categoryOpen} onDismiss={() => setCategoryOpen(false)} anchor={
            <Button mode="text" icon="folder-edit-outline" onPress={() => setCategoryOpen(true)}>Kategorie</Button>
          }>
            <Menu.Item title="Ohne Kategorie" onPress={() => { onAssign(entry, null); setCategoryOpen(false); }} />
            {categories.map((category) => <Menu.Item key={category.id} title={category.name} onPress={() => { onAssign(entry, category.id); setCategoryOpen(false); }} />)}
          </Menu>
          <IconButton icon="delete-outline" accessibilityLabel="Eintrag löschen" disabled={Boolean(busy)} onPress={async () => { if (await confirmDelete('Dieser Satz wird dauerhaft gelöscht.')) onDelete(entry); }} />
        </View>
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  control: { minHeight: 48 },
  card: { width: '100%', borderRadius: 20 },
  cardContent: { gap: 16 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  languageBlock: { gap: 5, padding: 16, borderRadius: 14 },
  audioPlayer: { minHeight: 64, borderRadius: 18, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  audioProgress: { flex: 1, minWidth: 100, gap: 1 },
  audioError: { padding: 12, borderRadius: 12, gap: 4 },
  cardActions: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
