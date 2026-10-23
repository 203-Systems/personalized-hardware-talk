CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`version` text NOT NULL,
	`slide` integer NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`author` text NOT NULL,
	`x` real,
	`y` real,
	`status` text DEFAULT 'open' NOT NULL,
	`edit_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `feedback_page` ON `feedback` (`version`,`slide`,`created_at`);--> statement-breakpoint
CREATE INDEX `feedback_parent` ON `feedback` (`parent_id`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`bucket` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`reset_at` integer NOT NULL
);
