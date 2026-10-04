variable "region" {
  description = "AWS region for all resources."
  type        = string
  default     = "us-east-1"
}

variable "name" {
  description = "Name prefix for resources."
  type        = string
  default     = "towers"
}

variable "lambda_reserved_concurrency" {
  description = "Reserved Lambda concurrency (caps cost). Use -1 for unreserved, e.g. on a new account with a low concurrency quota."
  type        = number
  default     = 25
}

variable "budget_email" {
  description = "Email for the monthly cost budget alarm. Empty disables the budget."
  type        = string
  default     = ""
}

variable "monthly_budget_usd" {
  description = "Monthly cost budget in USD (used when budget_email is set)."
  type        = number
  default     = 10
}
