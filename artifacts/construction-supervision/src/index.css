@import url('https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@400;500;600;700;800&display=swap');
@import "tailwindcss";
@import "tw-animate-css";
@import "leaflet/dist/leaflet.css";
@plugin "@tailwindcss/typography";

/* Force Western Arabic (Latin) numerals 0–9 throughout — prevents Arabic-Indic digit substitution */
@font-face {
  font-family: 'Latin Digits';
  src: local('Arial'), local('Helvetica Neue'), local('sans-serif');
  unicode-range: U+0030-0039, U+002E, U+002C, U+0025, U+002B, U+002D;
}

html, body, * {
  font-family: 'Latin Digits', 'Noto Kufi Arabic', 'Noto Sans Arabic', sans-serif;
}

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: hsl(var(--background));
  --color-foreground: hsl(var(--foreground));
  --color-border: hsl(var(--border));
  --color-input: hsl(var(--input));
  --color-ring: hsl(var(--ring));

  --color-card: hsl(var(--card));
  --color-card-foreground: hsl(var(--card-foreground));
  --color-card-border: hsl(var(--card-border));

  --color-popover: hsl(var(--popover));
  --color-popover-foreground: hsl(var(--popover-foreground));
  --color-popover-border: hsl(var(--popover-border));

  --color-primary: hsl(var(--primary));
  --color-primary-foreground: hsl(var(--primary-foreground));
  --color-primary-border: var(--primary-border);

  --color-secondary: hsl(var(--secondary));
  --color-secondary-foreground: hsl(var(--secondary-foreground));
  --color-secondary-border: var(--secondary-border);

  --color-muted: hsl(var(--muted));
  --color-muted-foreground: hsl(var(--muted-foreground));
  --color-muted-border: var(--muted-border);

  --color-accent: hsl(var(--accent));
  --color-accent-foreground: hsl(var(--accent-foreground));
  --color-accent-border: var(--accent-border);

  --color-destructive: hsl(var(--destructive));
  --color-destructive-foreground: hsl(var(--destructive-foreground));
  --color-destructive-border: var(--destructive-border);

  --color-chart-1: hsl(var(--chart-1));
  --color-chart-2: hsl(var(--chart-2));
  --color-chart-3: hsl(var(--chart-3));
  --color-chart-4: hsl(var(--chart-4));
  --color-chart-5: hsl(var(--chart-5));

  --color-sidebar: hsl(var(--sidebar));
  --color-sidebar-foreground: hsl(var(--sidebar-foreground));
  --color-sidebar-border: hsl(var(--sidebar-border));
  --color-sidebar-primary: hsl(var(--sidebar-primary));
  --color-sidebar-primary-foreground: hsl(var(--sidebar-primary-foreground));
  --color-sidebar-primary-border: var(--sidebar-primary-border);
  --color-sidebar-accent: hsl(var(--sidebar-accent));
  --color-sidebar-accent-foreground: hsl(var(--sidebar-accent-foreground));
  --color-sidebar-accent-border: var(--sidebar-accent-border);
  --color-sidebar-ring: hsl(var(--sidebar-ring));

  --font-sans: var(--app-font-sans);
  --font-serif: var(--app-font-serif);
  --font-mono: var(--app-font-mono);

  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}

  /* LIGHT MODE */
:root {
  --button-outline: rgba(0,0,0, .05);
  --badge-outline: rgba(0,0,0, .05);

  --opaque-button-border-intensity: -6;

  --elevate-1: rgba(0,0,0, .03);
  --elevate-2: rgba(0,0,0, .06);

  /* Page background — clean soft pearl */
  --background: 210 40% 98%;
  --foreground: 222 47% 11%;
  --border: 214 32% 91%;

  /* Cards — pure white */
  --card: 0 0% 100%;
  --card-foreground: 222 47% 11%;
  --card-border: 214 32% 91%;

  /* Sidebar — premium midnight blue */
  --sidebar: 222 47% 11%;
  --sidebar-foreground: 210 40% 98%;
  --sidebar-border: 222 40% 16%;
  --sidebar-primary: 218 80% 45%;
  --sidebar-primary-foreground: 0 0% 100%;
  --sidebar-accent: 222 40% 18%;
  --sidebar-accent-foreground: 210 40% 98%;
  --sidebar-ring: 218 80% 45%;

  /* Popover */
  --popover: 0 0% 100%;
  --popover-foreground: 222 47% 11%;
  --popover-border: 214 32% 91%;

  /* Primary — Deep Trust Blue */
  --primary: 221 83% 40%;
  --primary-foreground: 0 0% 100%;

  /* Secondary */
  --secondary: 210 40% 96.1%;
  --secondary-foreground: 222 47% 11%;

  /* Muted */
  --muted: 210 40% 96.1%;
  --muted-foreground: 215.4 16.3% 46.9%;

  /* Accent — Premium Gold/Amber */
  --accent: 43 96% 56%;
  --accent-foreground: 222 47% 11%;

  /* Destructive */
  --destructive: 0 84.2% 60.2%;
  --destructive-foreground: 210 40% 98%;

  --input: 214.3 31.8% 91.4%;
  --ring: 221 83% 53.3%;

  /* Charts */
  --chart-1: 221 83% 40%;
  --chart-2: 43 96% 56%;
  --chart-3: 158 52% 42%;
  --chart-4: 270 42% 52%;
  --chart-5: 0 58% 50%;

  --app-font-sans: 'Noto Kufi Arabic', sans-serif;
  --app-font-serif: Georgia, serif;
  --app-font-mono: Menlo, monospace;
  --radius: 0.75rem;

  /* Real subtle shadows */
  --shadow-2xs: 0 1px 2px 0 rgba(0,0,0,0.04);
  --shadow-xs: 0 1px 2px 0 rgba(0,0,0,0.06);
  --shadow-sm: 0 1px 3px 0 rgba(0,0,0,0.08), 0 1px 2px -1px rgba(0,0,0,0.05);
  --shadow: 0 1px 3px 0 rgba(0,0,0,0.08), 0 1px 2px -1px rgba(0,0,0,0.06);
  --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.08), 0 2px 4px -2px rgba(0,0,0,0.05);
  --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -4px rgba(0,0,0,0.05);
  --shadow-xl: 0 20px 25px -5px rgba(0,0,0,0.08), 0 8px 10px -6px rgba(0,0,0,0.05);
  --shadow-2xl: 0 25px 50px -12px rgba(0,0,0,0.12);

  --tracking-normal: 0em;
  --spacing: 0.25rem;

  --sidebar-primary-border: hsl(var(--sidebar-primary));
  --sidebar-primary-border: hsl(from hsl(var(--sidebar-primary)) h s calc(l + var(--opaque-button-border-intensity)) / alpha);

  --sidebar-accent-border: hsl(var(--sidebar-accent));
  --sidebar-accent-border: hsl(from hsl(var(--sidebar-accent)) h s calc(l + var(--opaque-button-border-intensity)) / alpha);

  --primary-border: hsl(var(--primary));
  --primary-border: hsl(from hsl(var(--primary)) h s calc(l + var(--opaque-button-border-intensity)) / alpha);

  --secondary-border: hsl(var(--secondary));
  --secondary-border: hsl(from hsl(var(--secondary)) h s calc(l + var(--opaque-button-border-intensity)) / alpha);

  --muted-border: hsl(var(--muted));
  --muted-border: hsl(from hsl(var(--muted)) h s calc(l + var(--opaque-button-border-intensity)) / alpha);

  --accent-border: hsl(var(--accent));
  --accent-border: hsl(from hsl(var(--accent)) h s calc(l + var(--opaque-button-border-intensity)) / alpha);

  --destructive-border: hsl(var(--destructive));
  --destructive-border: hsl(from hsl(var(--destructive)) h s calc(l + var(--opaque-button-border-intensity)) / alpha);
}

.dark {
  --button-outline: rgba(255,255,255, .10);
  --badge-outline: rgba(255,255,255, .05);

  --opaque-button-border-intensity: 9;

  --elevate-1: rgba(255,255,255, .04);
  --elevate-2: rgba(255,255,255, .09);

  --background: 222 47% 7%;
  --foreground: 210 40% 98%;
  --border: 217.2 32.6% 17.5%;
  
  --card: 222 47% 9%;
  --card-foreground: 210 40% 98%;
  --card-border: 217.2 32.6% 17.5%;

  --sidebar: 222 47% 7%;
  --sidebar-foreground: 210 40% 98%;
  --sidebar-border: 217.2 32.6% 17.5%;
  --sidebar-primary: 221 83% 53.3%;
  --sidebar-primary-foreground: 0 0% 100%;
  --sidebar-accent: 217.2 32.6% 17.5%;
  --sidebar-accent-foreground: 210 40% 98%;
  --sidebar-ring: 221 83% 53.3%;

  --popover: 222 47% 9%;
  --popover-foreground: 210 40% 98%;
  --popover-border: 217.2 32.6% 17.5%;

  --primary: 221 83% 53.3%;
  --primary-foreground: 222.2 47.4% 11.2%;

  --secondary: 217.2 32.6% 17.5%;
  --secondary-foreground: 210 40% 98%;

  --muted: 217.2 32.6% 17.5%;
  --muted-foreground: 215 20.2% 65.1%;

  --accent: 43 96% 56%;
  --accent-foreground: 222 47% 11%;

  --destructive: 0 62.8% 30.6%;
  --destructive-foreground: 210 40% 98%;

  --input: 217.2 32.6% 17.5%;
  --ring: 221 83% 53.3%;

  --chart-1: 221 83% 53.3%;
  --chart-2: 43 96% 56%;
  --chart-3: 158 52% 42%;
  --chart-4: 270 42% 56%;
  --chart-5: 0 58% 54%;

  --shadow-2xs: 0 1px 2px 0 rgba(0,0,0,0.2);
  --shadow-xs: 0 1px 2px 0 rgba(0,0,0,0.25);
  --shadow-sm: 0 1px 3px 0 rgba(0,0,0,0.3), 0 1px 2px -1px rgba(0,0,0,0.2);
  --shadow: 0 1px 3px 0 rgba(0,0,0,0.3), 0 1px 2px -1px rgba(0,0,0,0.25);
  --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.3), 0 2px 4px -2px rgba(0,0,0,0.2);
  --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.3), 0 4px 6px -4px rgba(0,0,0,0.2);
  --shadow-xl: 0 20px 25px -5px rgba(0,0,0,0.3), 0 8px 10px -6px rgba(0,0,0,0.2);
  --shadow-2xl: 0 25px 50px -12px rgba(0,0,0,0.4);
}

@layer base {
  * {
    @apply border-border/80;
  }

  body {
    @apply font-sans antialiased bg-background text-foreground;
  }
}

@layer utilities {
  .glass {
    @apply bg-background/60 backdrop-blur-xl border border-white/20 dark:border-white/5 shadow-sm;
  }
  
  .glass-card {
    @apply bg-card/80 backdrop-blur-xl border border-white/20 dark:border-white/10 shadow-sm transition-all duration-300;
  }
  
  .hover-card-premium {
    @apply transition-all duration-300 hover:shadow-lg hover:-translate-y-1 hover:border-primary/30 dark:hover:border-primary/50;
  }
  
  .bg-gradient-premium {
    @apply bg-gradient-to-br from-primary via-primary/90 to-primary/70;
  }
  
  .bg-gradient-subtle {
    @apply bg-gradient-to-br from-background via-background to-secondary/30;
  }
  input[type="search"]::-webkit-search-cancel-button {
    @apply hidden;
  }

  [contenteditable][data-placeholder]:empty::before {
    content: attr(data-placeholder);
    color: hsl(var(--muted-foreground));
    pointer-events: none;
  }

  .no-default-hover-elevate {}
  .no-default-active-elevate {}

  .toggle-elevate::before,
  .toggle-elevate-2::before {
    content: "";
    pointer-events: none;
    position: absolute;
    inset: 0px;
    border-radius: inherit;
    z-index: -1;
  }

  .toggle-elevate.toggle-elevated::before {
    background-color: var(--elevate-2);
  }

  .border.toggle-elevate::before {
    inset: -1px;
  }

  .hover-elevate:not(.no-default-hover-elevate),
  .active-elevate:not(.no-default-active-elevate),
  .hover-elevate-2:not(.no-default-hover-elevate),
  .active-elevate-2:not(.no-default-active-elevate) {
    position: relative;
    z-index: 0;
  }

  .hover-elevate:not(.no-default-hover-elevate)::after,
  .active-elevate:not(.no-default-active-elevate)::after,
  .hover-elevate-2:not(.no-default-hover-elevate)::after,
  .active-elevate-2:not(.no-default-active-elevate)::after {
    content: "";
    pointer-events: none;
    position: absolute;
    inset: 0px;
    border-radius: inherit;
    z-index: 999;
  }

  .hover-elevate:hover:not(.no-default-hover-elevate)::after,
  .active-elevate:active:not(.no-default-active-elevate)::after {
    background-color: var(--elevate-1);
  }

  .hover-elevate-2:hover:not(.no-default-hover-elevate)::after,
  .active-elevate-2:active:not(.no-default-active-elevate)::after {
    background-color: var(--elevate-2);
  }

  .border.hover-elevate:not(.no-hover-interaction-elevate)::after,
  .border.active-elevate:not(.no-active-interaction-elevate)::after,
  .border.hover-elevate-2:not(.no-hover-interaction-elevate)::after,
  .border.active-elevate-2:not(.no-active-interaction-elevate)::after,
  .border.hover-elevate:not(.no-hover-interaction-elevate)::after {
    inset: -1px;
  }
}
