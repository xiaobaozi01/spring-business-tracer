package com.acme.gateway.client;

import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

@Component
public class CatalogRestClient {
    private final RestTemplate restTemplate = new RestTemplate();
    public String fetch(String sku) {
        return restTemplate.getForObject("http://catalog-service/api/catalog/" + sku, String.class);
    }
    public String dynamic(String url) { return restTemplate.getForObject(url, String.class); }
}
