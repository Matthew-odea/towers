output "site_url" {
  value = "https://${aws_cloudfront_distribution.site.domain_name}"
}

output "ws_url" {
  value = "${aws_apigatewayv2_api.ws.api_endpoint}/${aws_apigatewayv2_stage.prod.name}"
}

output "bucket_name" {
  value = aws_s3_bucket.site.id
}

output "distribution_id" {
  value = aws_cloudfront_distribution.site.id
}

output "table_name" {
  value = aws_dynamodb_table.main.name
}
