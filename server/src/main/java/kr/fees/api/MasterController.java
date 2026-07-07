package kr.fees.api;

import kr.fees.domain.AccountModel;
import kr.fees.domain.ProductModel;
import kr.fees.domain.RuleModel;
import kr.fees.persistence.*;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/** 마스터 조회 — 계좌·품목·요율표·룰. */
@RestController
@RequestMapping("/api")
public class MasterController {

    private final AccountRepository accounts;
    private final ProductRepository products;
    private final ScheduleRepository schedules;
    private final RuleRepository rules;

    public MasterController(AccountRepository accounts, ProductRepository products,
                            ScheduleRepository schedules, RuleRepository rules) {
        this.accounts = accounts;
        this.products = products;
        this.schedules = schedules;
        this.rules = rules;
    }

    @GetMapping("/accounts")
    public List<AccountModel> accounts() {
        return accounts.findAll();
    }

    @GetMapping("/products")
    public List<ProductModel> products() {
        return products.findAll();
    }

    @GetMapping("/schedules")
    public Object schedules() {
        return schedules.findAllAsMap().values();
    }

    @GetMapping("/rules")
    public List<RuleModel> rules() {
        return rules.findAll();
    }

    @GetMapping("/rules/{ruleId}")
    public RuleModel rule(@PathVariable String ruleId) {
        return rules.findById(ruleId).orElseThrow(() -> ApiException.notFound("룰 없음: " + ruleId));
    }
}
