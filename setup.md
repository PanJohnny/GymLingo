# Nastavení
## SQL
Následující kód slouží k vytvoření potřebních tabulek v SQL databázi:
```sql
CREATE TABLE `lessons` (
	`id` int NOT NULL AUTO_INCREMENT,
	`type` int NOT NULL,
	`czech` varchar(255) NOT NULL,
	`polish` varchar(255) NOT NULL,
	`group` varchar(255),
	`explanation` varchar(255),
	PRIMARY KEY (`id`)
);

CREATE TABLE `lpu` (
	`id` int NOT NULL AUTO_INCREMENT,
	`user_id` int NOT NULL,
	`lesson_id` int NOT NULL,
	`group` varchar(255) NOT NULL,
	PRIMARY KEY (`id`)
);

CREATE TABLE `users` (
	`id` int NOT NULL AUTO_INCREMENT,
	`username` varchar(255) NOT NULL,
	`icon_url` varchar(255),
	`password` varchar(255) NOT NULL,
	`token` binary(16) NOT NULL,
	`token_created_at` timestamp NOT NULL DEFAULT current_timestamp(),
	`admin` tinyint(1),
	PRIMARY KEY (`id`)
);
```

## Enviroment proměnné
Je potřeba mít tyto proměnné:
 - `DATABASE_URL` url k vaší databázy s read and write povolením
 - `PIXABAY_TOKEN` token k [pixabay.com API](https://pixabay.com/api/docs/) pro získávání ilustračních obrázků
 - `CAPTCHA_KEY` kód stránky ke CloudFlare Turnstile, pro testování: `1x00000000000000000000BB`
 - `CAPTCHA_SECRET` tajný kód ke CloudFlare Turnstile, pro testování: `1x0000000000000000000000000000000AA`