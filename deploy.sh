#!/bin/zsh

set -e

BUCKET=phulin-me

cd $(dirname "$0")

aws sso login
aws s3 sync dist/ "s3://$BUCKET"

distribution=$(aws cloudfront list-distributions --output json \
    | jq -r '.DistributionList.Items[]?
        | select((.Aliases.Items // []) | index("phulin.me"))
        | .Id')

echo "Invalidating distribution $distribution..."
aws cloudfront create-invalidation --distribution-id "$distribution" --paths "/*"
echo "Deployment complete!"