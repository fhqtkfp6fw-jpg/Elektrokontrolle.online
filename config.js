/* Zugang zur Online-Datenbank.
   Beide Werte stehen im Supabase-Projekt unter Project Settings:
     SUPABASE_URL  → Data API → Project URL
     SUPABASE_KEY  → API Keys → anon / public
   Der anon-Schlüssel darf öffentlich sein: Was jemand sehen darf, entscheidet
   die Datenbank (Row Level Security), nicht die App.
   NIEMALS den service_role-Schlüssel hier eintragen!

   WICHTIG: Beide Werte müssen in Anführungszeichen stehen ('...'). */

const SUPABASE_URL = 'https://drseihabnxfkkrrtxaze.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRyc2VpaGFibnhma2tycnR4YXplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxNzg3OTEsImV4cCI6MjEwMTc1NDc5MX0.2faYmKaNx5hJzHuPFKrlEETs67criVxmx7EV1DtvFy4';
