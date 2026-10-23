CREATE TABLE `personas` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`avatar` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
